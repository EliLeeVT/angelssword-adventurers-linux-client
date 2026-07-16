#!/usr/bin/env node
/**
 * AS Adventurer — Linux / cross-platform server
 *
 * Real-time streaming overlay driven by facial tracking + mic detection.
 * Serves the Control Panel and OBS overlay, and bridges UDP face-tracking
 * sources (VTube Studio, iFacialMocap) plus browser webcam/mic.
 *
 * Compatible with the public/ frontend shipped with AS Adventurer.
 */

'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');

// ── Paths ──────────────────────────────────────────
// When packaged with pkg, assets live next to the executable.
// When run as Node, assets live next to this file.
const ROOT = (process.pkg
  ? path.dirname(process.execPath)
  : __dirname);
const PUBLIC_DIR = path.join(ROOT, 'public');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');

// ── Ports ──────────────────────────────────────────
const PREFERRED_PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_PORT_ATTEMPTS = 10;
const VTS_SEND_PORT = 21412;
const VTS_RECV_PORT = 11125;
const IFACIAL_PORT = 49983;
const DEBUG_UDP = process.env.DEBUG_UDP === '1';

// ── Asset / emote conventions ──────────────────────
const STATE_NAMES = [
  'neutral_idle', 'neutral_speaking',
  'happy_idle', 'happy_speaking',
  'sad_idle', 'sad_speaking',
  'surprised_idle', 'surprised_speaking',
  'typing',
  'eyes_closed',
];

const ASSET_EXTENSIONS = ['.webm', '.webp', '.gif', '.png', '.mp4'];
const SOUND_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a'];

const EMOTE_FILE_NAMES = [
  'animation', 'idle', 'speaking', 'intro', 'outro',
  'animation_sound', 'intro_sound', 'outro_sound', 'sound', 'idle_sound',
];

// ── Runtime state ──────────────────────────────────
let activeModel = null;
let activeEmote = null;

const thresholds = {
  smile: 20,
  frown: 25,
  surprised: 25,
  eyesClosed: 55,
  expressionHold: 300,
  exitBias: 0.4,
};

const HYSTERESIS_MS = 150;       // minimum hold before switching (base)
const EXIT_HYSTERESIS_MS = 150;  // minimum hold before leaving an expression
const BROADCAST_INTERVAL = 33;   // ~30 fps tracking updates to UI

let currentExpression = 'neutral';
let pendingExpression = null;
let pendingExpressionSince = 0;
let lastScores = { smile: 0, frown: 0, surprised: 0, eyesClosed: 0 };
let lastSource = 'none';
let lastBroadcast = 0;

// ── Helpers ────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function findFile(dir, baseName, extensions) {
  if (!fs.existsSync(dir)) return null;
  for (const ext of extensions) {
    const candidate = path.join(dir, baseName + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  // Case-insensitive fallback
  try {
    const entries = fs.readdirSync(dir);
    const lower = baseName.toLowerCase();
    for (const entry of entries) {
      const parsed = path.parse(entry);
      if (parsed.name.toLowerCase() === lower &&
          extensions.includes(parsed.ext.toLowerCase())) {
        return path.join(dir, entry);
      }
    }
  } catch { /* ignore */ }
  return null;
}

function toPublicUrl(absPath) {
  const rel = path.relative(PUBLIC_DIR, absPath).split(path.sep).join('/');
  return '/' + rel.split('/').map(encodeURIComponent).join('/');
}

function uniqueUrls(list) {
  return [...new Set(list.filter(Boolean))];
}

function scanVariants(dir, baseName, extensions) {
  const results = [];
  const primary = findFile(dir, baseName, extensions);
  if (primary) results.push(toPublicUrl(primary));

  // intro2, intro3, ... (and case variants)
  for (let i = 2; i <= 9; i++) {
    const f = findFile(dir, baseName + i, extensions);
    if (f) results.push(toPublicUrl(f));
  }
  return results;
}

function scanSoundVariants(dir, baseName) {
  return scanVariants(dir, baseName, SOUND_EXTENSIONS);
}

// ── Model / asset scanning ─────────────────────────
function listModelDirs() {
  ensureDir(ASSETS_DIR);
  const models = [];
  let entries;
  try {
    entries = fs.readdirSync(ASSETS_DIR, { withFileTypes: true });
  } catch (e) {
    console.warn('[models] Could not scan asset directories:', e.message);
    return models;
  }

  // Flat assets in assets/ root → "Default"
  const rootAssets = scanModelAssets(ASSETS_DIR, null);
  const rootCount = Object.keys(rootAssets).filter(k => !k.startsWith('_')).length;
  if (rootCount > 0) {
    models.push({ name: 'Default', assetCount: rootCount, dir: ASSETS_DIR });
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'emotes') continue;
    const dir = path.join(ASSETS_DIR, entry.name);
    const assets = scanModelAssets(dir, entry.name);
    const count = Object.keys(assets).filter(k => !k.startsWith('_')).length;
    models.push({ name: entry.name, assetCount: count, dir });
  }
  return models;
}

function getModelDir(modelName) {
  if (!modelName || modelName === 'Default') {
    // Prefer a named Default folder if present, else assets root
    const named = path.join(ASSETS_DIR, 'Default');
    if (fs.existsSync(named) && fs.statSync(named).isDirectory()) return named;
    return ASSETS_DIR;
  }
  // Prevent path traversal
  const base = path.basename(modelName);
  if (base !== modelName || modelName.includes('..')) return null;
  const dir = path.join(ASSETS_DIR, base);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  return dir;
}

function scanModelAssets(dir, modelName) {
  const assets = {};
  for (const state of STATE_NAMES) {
    const f = findFile(dir, state, ASSET_EXTENSIONS);
    if (f) assets[state] = toPublicUrl(f);
  }
  return assets;
}

// ── Emote scanning ─────────────────────────────────
function scanSubs(subsDir, urlBase) {
  if (!fs.existsSync(subsDir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(subsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const subs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subDir = path.join(subsDir, entry.name);
    const subUrl = urlBase + '/' + encodeURIComponent(entry.name);

    const files = {};
    const anim = findFile(subDir, 'animation', ASSET_EXTENSIONS);
    if (anim) files.animation = toPublicUrl(anim);
    const animVars = scanVariants(subDir, 'animation', ASSET_EXTENSIONS);
    if (animVars.length > 1) files.animation_variants = animVars;

    // Some models use intro.webm instead of animation.webm for sub transitions
    const intro = findFile(subDir, 'intro', ASSET_EXTENSIONS);
    if (intro) {
      files.intro = toPublicUrl(intro);
      if (!files.animation) files.animation = files.intro;
    }
    const introVars = scanVariants(subDir, 'intro', ASSET_EXTENSIONS);
    if (introVars.length > 1) {
      files.intro_variants = introVars;
      if (!files.animation_variants) files.animation_variants = introVars;
    }

    const idle = findFile(subDir, 'idle', ASSET_EXTENSIONS);
    if (idle) files.idle = toPublicUrl(idle);
    const speaking = findFile(subDir, 'speaking', ASSET_EXTENSIONS);
    if (speaking) files.speaking = toPublicUrl(speaking);

    const outroVars = uniqueUrls([
      ...scanVariants(subDir, 'outro', ASSET_EXTENSIONS),
      ...scanVariants(subDir, 'Outro', ASSET_EXTENSIONS),
    ]);
    if (outroVars.length) {
      files.outro = outroVars[0];
      if (outroVars.length > 1) files.outro_variants = outroVars;
    }

    const sound = findFile(subDir, 'sound', SOUND_EXTENSIONS);
    if (sound) files.sound = toPublicUrl(sound);
    const soundVars = uniqueUrls(scanSoundVariants(subDir, 'sound'));
    if (soundVars.length > 1) files.sound_variants = soundVars;

    const introSoundVars = uniqueUrls([
      ...scanSoundVariants(subDir, 'intro_sound'),
      ...scanSoundVariants(subDir, 'Intro_sound'),
    ]);
    if (introSoundVars.length) {
      files.intro_sound = introSoundVars[0];
      if (introSoundVars.length > 1) files.intro_sound_variants = introSoundVars;
    }

    const outroSoundVars = uniqueUrls([
      ...scanSoundVariants(subDir, 'outro_sound'),
      ...scanSoundVariants(subDir, 'Outro_sound'),
    ]);
    if (outroSoundVars.length) {
      files.outro_sound = outroSoundVars[0];
      if (outroSoundVars.length > 1) files.outro_sound_variants = outroSoundVars;
    }

    const idleSound = findFile(subDir, 'idle_sound', SOUND_EXTENSIONS);
    if (idleSound) files.idle_sound = toPublicUrl(idleSound);

    const nested = scanSubs(path.join(subDir, 'subs'), subUrl + '/subs');

    // Only include if it has something useful
    if (Object.keys(files).length > 0 || nested.length > 0) {
      subs.push({
        name: entry.name,
        files,
        subs: nested,
      });
    }
  }
  return subs;
}

function scanEmotes(modelDir) {
  const emotesDir = path.join(modelDir, 'emotes');
  if (!fs.existsSync(emotesDir)) {
    // Also check assets/emotes for Default flat layout
    const rootEmotes = path.join(ASSETS_DIR, 'emotes');
    if (modelDir === ASSETS_DIR && fs.existsSync(rootEmotes)) {
      // fall through with rootEmotes
    } else {
      return [];
    }
  }

  const dir = fs.existsSync(emotesDir) ? emotesDir : path.join(ASSETS_DIR, 'emotes');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.warn('[emotes] Could not scan emotes directory:', e.message);
    return [];
  }

  const emotes = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const emoteDir = path.join(dir, entry.name);
    const files = {};

    // Type 1 one-shot
    const animation = findFile(emoteDir, 'animation', ASSET_EXTENSIONS);
    if (animation) files.animation = toPublicUrl(animation);
    const animVars = scanVariants(emoteDir, 'animation', ASSET_EXTENSIONS);
    if (animVars.length > 1) files.animation_variants = animVars;

    const animSound = findFile(emoteDir, 'animation_sound', SOUND_EXTENSIONS);
    if (animSound) files.animation_sound = toPublicUrl(animSound);

    // Type 2 multi-phase
    const intro = findFile(emoteDir, 'intro', ASSET_EXTENSIONS);
    if (intro) files.intro = toPublicUrl(intro);
    const introVars = scanVariants(emoteDir, 'intro', ASSET_EXTENSIONS);
    if (introVars.length > 1) {
      files.intro_variants = introVars;
      if (introVars.length > 1) console.log(`[emotes] ${entry.name} intro variants: ${introVars.length}`);
    }

    const idle = findFile(emoteDir, 'idle', ASSET_EXTENSIONS);
    if (idle) files.idle = toPublicUrl(idle);

    const speaking = findFile(emoteDir, 'speaking', ASSET_EXTENSIONS);
    if (speaking) files.speaking = toPublicUrl(speaking);

    const outroUnique = uniqueUrls([
      ...scanVariants(emoteDir, 'outro', ASSET_EXTENSIONS),
      ...scanVariants(emoteDir, 'Outro', ASSET_EXTENSIONS),
    ]);
    if (outroUnique.length) {
      files.outro = outroUnique[0];
      if (outroUnique.length > 1) {
        files.outro_variants = outroUnique;
        console.log(`[emotes] ${entry.name} outro variants: ${outroUnique.length}`);
      }
    }

    const introSoundUnique = uniqueUrls([
      ...scanSoundVariants(emoteDir, 'intro_sound'),
      ...scanSoundVariants(emoteDir, 'Intro_sound'),
    ]);
    if (introSoundUnique.length) {
      files.intro_sound = introSoundUnique[0];
      if (introSoundUnique.length > 1) {
        files.intro_sound_variants = introSoundUnique;
        console.log(`[emotes] ${entry.name} intro_sound variants: ${introSoundUnique.length}`);
      }
    }

    const outroSoundUnique = uniqueUrls([
      ...scanSoundVariants(emoteDir, 'outro_sound'),
      ...scanSoundVariants(emoteDir, 'Outro_sound'),
    ]);
    if (outroSoundUnique.length) {
      files.outro_sound = outroSoundUnique[0];
      if (outroSoundUnique.length > 1) {
        files.outro_sound_variants = outroSoundUnique;
        console.log(`[emotes] ${entry.name} outro_sound variants: ${outroSoundUnique.length}`);
      }
    }

    const idleSound = findFile(emoteDir, 'idle_sound', SOUND_EXTENSIONS);
    if (idleSound) files.idle_sound = toPublicUrl(idleSound);

    const sound = findFile(emoteDir, 'sound', SOUND_EXTENSIONS);
    if (sound) files.sound = toPublicUrl(sound);

    const subs = scanSubs(path.join(emoteDir, 'subs'),
      toPublicUrl(emoteDir) + '/subs');

    // Determine type: Type 2 if intro/idle present, else Type 1 if animation
    let emoteType = 0;
    if (files.intro || files.idle || files.speaking || files.outro) {
      emoteType = 2;
    } else if (files.animation) {
      emoteType = 1;
    } else {
      continue; // nothing useful
    }

    emotes.push({
      name: entry.name,
      emoteType,
      files,
      subs,
    });
  }
  return emotes;
}

function resolveActiveModelDir() {
  if (activeModel) {
    const dir = getModelDir(activeModel);
    if (dir) return dir;
  }
  const models = listModelDirs();
  if (models.length > 0) {
    activeModel = models[0].name;
    return models[0].dir;
  }
  activeModel = 'Default';
  return ASSETS_DIR;
}

// ── Expression scoring ─────────────────────────────
// Blendshape name aliases: VTS PascalCase, iFacial underscore, MediaPipe camelCase
const BS_ALIASES = {
  EyeBlinkLeft: ['EyeBlinkLeft', 'eyeBlink_L', 'eyeBlinkLeft'],
  EyeBlinkRight: ['EyeBlinkRight', 'eyeBlink_R', 'eyeBlinkRight'],
  EyeSquintLeft: ['EyeSquintLeft', 'eyeSquint_L', 'eyeSquintLeft'],
  EyeSquintRight: ['EyeSquintRight', 'eyeSquint_R', 'eyeSquintRight'],
  EyeWideLeft: ['EyeWideLeft', 'eyeWide_L', 'eyeWideLeft'],
  EyeWideRight: ['EyeWideRight', 'eyeWide_R', 'eyeWideRight'],
  BrowDownLeft: ['BrowDownLeft', 'browDown_L', 'browDownLeft'],
  BrowDownRight: ['BrowDownRight', 'browDown_R', 'browDownRight'],
  BrowInnerUp: ['BrowInnerUp', 'browInnerUp', 'browInner_Up'],
  BrowOuterUpLeft: ['BrowOuterUpLeft', 'browOuterUp_L', 'browOuterUpLeft'],
  BrowOuterUpRight: ['BrowOuterUpRight', 'browOuterUp_R', 'browOuterUpRight'],
  CheekSquintLeft: ['CheekSquintLeft', 'cheekSquint_L', 'cheekSquintLeft'],
  CheekSquintRight: ['CheekSquintRight', 'cheekSquint_R', 'cheekSquintRight'],
  MouthSmileLeft: ['MouthSmileLeft', 'mouthSmile_L', 'mouthSmileLeft'],
  MouthSmileRight: ['MouthSmileRight', 'mouthSmile_R', 'mouthSmileRight'],
  MouthFrownLeft: ['MouthFrownLeft', 'mouthFrown_L', 'mouthFrownLeft'],
  MouthFrownRight: ['MouthFrownRight', 'mouthFrown_R', 'mouthFrownRight'],
  JawOpen: ['JawOpen', 'jawOpen', 'jaw_Open'],
  MouthFunnel: ['MouthFunnel', 'mouthFunnel', 'mouth_Funnel'],
};

function getBS(shapes, canonical) {
  const aliases = BS_ALIASES[canonical] || [canonical];
  for (const name of aliases) {
    if (shapes[name] !== undefined && shapes[name] !== null) {
      return Number(shapes[name]) || 0;
    }
  }
  // Case-insensitive fallback
  const lowerMap = {};
  for (const [k, v] of Object.entries(shapes)) {
    lowerMap[k.toLowerCase()] = v;
  }
  for (const name of aliases) {
    const v = lowerMap[name.toLowerCase()];
    if (v !== undefined && v !== null) return Number(v) || 0;
  }
  return 0;
}

function avg(...vals) {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function detectExpression(shapes) {
  const smile = avg(getBS(shapes, 'MouthSmileLeft'), getBS(shapes, 'MouthSmileRight'));
  const frown = avg(getBS(shapes, 'MouthFrownLeft'), getBS(shapes, 'MouthFrownRight'));
  const eyeWide = avg(getBS(shapes, 'EyeWideLeft'), getBS(shapes, 'EyeWideRight'));
  const browOuter = avg(getBS(shapes, 'BrowOuterUpLeft'), getBS(shapes, 'BrowOuterUpRight'));
  const jawOpen = getBS(shapes, 'JawOpen');
  const browInner = getBS(shapes, 'BrowInnerUp');
  // Composite surprise: eyes wide + brows up + jaw
  const surprised = avg(eyeWide, browOuter, Math.min(100, jawOpen * 0.8 + browInner * 0.4));
  const eyesClosed = avg(getBS(shapes, 'EyeBlinkLeft'), getBS(shapes, 'EyeBlinkRight'));

  const scores = {
    smile,
    frown,
    surprised,
    eyesClosed,
  };

  // Determine raw expression from scores vs thresholds (with exit bias hysteresis)
  const thr = thresholds;
  const exitMul = 1 - (thr.exitBias || 0);

  function above(score, threshold, isCurrent) {
    if (isCurrent) return score >= threshold * exitMul;
    return score >= threshold;
  }

  // Priority: eyes_closed > surprised > happy > sad > neutral
  let next = 'neutral';
  if (above(eyesClosed, thr.eyesClosed, currentExpression === 'eyes_closed')) {
    next = 'eyes_closed';
  } else if (above(surprised, thr.surprised, currentExpression === 'surprised')) {
    next = 'surprised';
  } else if (above(smile, thr.smile, currentExpression === 'happy') &&
             smile >= frown) {
    next = 'happy';
  } else if (above(frown, thr.frown, currentExpression === 'sad')) {
    next = 'sad';
  }

  return { expression: next, scores };
}

function getCurrentExpressionScore(scores, expression) {
  switch (expression) {
    case 'happy': return scores.smile;
    case 'sad': return scores.frown;
    case 'surprised': return scores.surprised;
    case 'eyes_closed': return scores.eyesClosed;
    default: return 0;
  }
}

// ── Tracking ingest ────────────────────────────────
function handleTrackingData(shapes, source) {
  if (!shapes || typeof shapes !== 'object') return;

  const { expression: rawExpr, scores } = detectExpression(shapes);
  lastScores = scores;
  lastSource = source;

  const now = Date.now();
  const holdMs = Math.max(HYSTERESIS_MS, thresholds.expressionHold || 0);

  if (rawExpr !== currentExpression) {
    if (pendingExpression !== rawExpr) {
      pendingExpression = rawExpr;
      pendingExpressionSince = now;
    } else if (now - pendingExpressionSince >= holdMs) {
      // Extra exit hysteresis when leaving a non-neutral expression
      if (currentExpression !== 'neutral' && rawExpr === 'neutral') {
        if (now - pendingExpressionSince < Math.max(holdMs, EXIT_HYSTERESIS_MS)) {
          // still waiting
        } else {
          currentExpression = rawExpr;
          pendingExpression = null;
        }
      } else {
        currentExpression = rawExpr;
        pendingExpression = null;
      }
    }
  } else {
    pendingExpression = null;
  }

  throttledBroadcast(source);
}

function throttledBroadcast(source) {
  const now = Date.now();
  if (now - lastBroadcast < BROADCAST_INTERVAL) return;
  lastBroadcast = now;

  const payload = {
    type: 'expression',
    expression: currentExpression,
    source: source || lastSource,
    smile: lastScores.smile,
    frown: lastScores.frown,
    surprised: lastScores.surprised,
    eyesClosed: lastScores.eyesClosed,
  };

  // Control panel also accepts type: 'tracking'
  broadcast(payload);
  broadcast({ ...payload, type: 'tracking' });
}

// ── Protocol parsers ───────────────────────────────
function parseIFacialMocap(text) {
  // Format: BlendShape-Value|BlendShape-Value|...|=head#...|rightEye#...|leftEye#...
  const shapes = {};
  const main = text.split('=')[0] || text;
  const parts = main.split('|');
  for (const part of parts) {
    if (!part || part.includes('#')) continue;
    // Name-value; value is 0-100
    const dash = part.lastIndexOf('-');
    if (dash <= 0) continue;
    const key = part.slice(0, dash).trim();
    const val = parseFloat(part.slice(dash + 1));
    if (!key || Number.isNaN(val)) continue;
    shapes[key] = val;
  }
  return shapes;
}

function parseVTubeStudio(msg) {
  // VTS iOS tracking UDP typically sends JSON with FaceFound + BlendShapes
  let data;
  try {
    data = typeof msg === 'string' ? JSON.parse(msg) : msg;
  } catch {
    return null;
  }

  // Some payloads wrap the tracking object
  if (data.data) data = data.data;

  const faceFound = data.FaceFound ?? data.faceFound;
  if (faceFound === false) return null;

  const shapes = {};
  const bs = data.BlendShapes || data.blendShapes || data.Blendshapes;

  if (Array.isArray(bs)) {
    for (const item of bs) {
      if (!item) continue;
      if (typeof item === 'object') {
        const key = item.k ?? item.K ?? item.key ?? item.name ?? item.Name;
        const val = item.v ?? item.V ?? item.value ?? item.Value;
        if (key !== undefined && val !== undefined) {
          // VTS often uses 0-1; normalize to 0-100 if needed
          const n = Number(val);
          shapes[key] = n <= 1.5 ? n * 100 : n;
        }
      }
    }
  } else if (bs && typeof bs === 'object') {
    for (const [key, val] of Object.entries(bs)) {
      const n = Number(val);
      if (Number.isNaN(n)) continue;
      shapes[key] = n <= 1.5 ? n * 100 : n;
    }
  }

  if (Object.keys(shapes).length === 0) {
    if (DEBUG_UDP && faceFound) {
      console.log('[vts-parser] FaceFound but no BlendShapes parsed. Keys:', Object.keys(data));
    }
    return null;
  }
  return shapes;
}

// ── WebSocket clients ──────────────────────────────
const clients = new Set();

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1 && (ws.clientType === 'overlay' || ws.clientType === 'control' || !ws.clientType)) {
      try { ws.send(msg); } catch { /* ignore */ }
    }
  }
}

function broadcastAll(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      try { ws.send(msg); } catch { /* ignore */ }
    }
  }
}

// ── HTTP + WS server ───────────────────────────────
const app = express();
const server = http.createServer(app);

ensureDir(ASSETS_DIR);
app.use(express.static(PUBLIC_DIR));
app.use(express.json({ limit: '16kb' }));

// Models
app.get('/api/models', (_req, res) => {
  const models = listModelDirs().map(m => ({
    name: m.name,
    assetCount: m.assetCount,
  }));
  if (!activeModel && models.length) activeModel = models[0].name;
  res.json({ models, active: activeModel });
});

app.get('/api/assets', (req, res) => {
  const modelName = req.query.model || activeModel;
  const dir = getModelDir(modelName) || resolveActiveModelDir();
  res.json(scanModelAssets(dir, modelName));
});

app.post('/api/models/select', (req, res) => {
  const model = req.body?.model;
  if (!model || typeof model !== 'string') {
    return res.status(400).json({ success: false, error: 'model name required' });
  }
  const safe = model.substring(0, 128);
  const dir = getModelDir(safe);
  if (!dir) {
    return res.status(400).json({ success: false, error: 'invalid model name' });
  }
  activeModel = path.basename(safe) === 'Default' || safe === 'Default' ? 'Default' : path.basename(safe);
  // If it's literally Default from flat layout
  if (safe === 'Default') activeModel = 'Default';
  else activeModel = path.basename(safe);

  console.log('[model] Switched to:', activeModel);
  activeEmote = null;
  broadcastAll({ type: 'model_change', model: activeModel });
  res.json({ success: true, model: activeModel });
});

// Emotes
app.get('/api/emotes', (_req, res) => {
  const dir = resolveActiveModelDir();
  res.json(scanEmotes(dir));
});

app.post('/api/emote/trigger', (req, res) => {
  const name = req.body?.name;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ success: false, error: 'emote name required' });
  }
  const emotes = scanEmotes(resolveActiveModelDir());
  const emote = emotes.find(e => e.name === name);
  if (!emote) {
    return res.status(404).json({ success: false, error: `emote '${name}' not found` });
  }
  activeEmote = emote;
  console.log(`[emote] Triggered: ${emote.name} (type ${emote.emoteType})`);
  broadcastAll({ type: 'emote', action: 'trigger', emote });
  res.json({ success: true });
});

app.post('/api/emote/release', (_req, res) => {
  console.log('[emote] Released:', activeEmote?.name || '(none)');
  activeEmote = null;
  broadcastAll({ type: 'emote', action: 'release' });
  res.json({ success: true });
});

app.post('/api/emote/sub', (req, res) => {
  const name = req.body?.name;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ success: false, error: 'sub-animation name required' });
  }
  if (!activeEmote) {
    return res.status(400).json({ success: false, error: 'no emote is active' });
  }

  // Path like "ignition" or "ignition/attack"
  const parts = name.split('/').filter(Boolean);
  let node = activeEmote;
  let sub = null;
  for (const part of parts) {
    const list = node.subs || [];
    sub = list.find(s => s.name === part);
    if (!sub) {
      return res.status(404).json({
        success: false,
        error: `sub-animation '${part}' not found at path '${name}'`,
      });
    }
    node = sub;
  }

  console.log('[emote] Sub-animation:', name);
  broadcastAll({
    type: 'emote',
    action: 'sub',
    sub: { ...sub, parentEmote: activeEmote.name },
  });
  res.json({ success: true });
});

// Thresholds
app.post('/api/thresholds', (req, res) => {
  const body = req.body || {};
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  if (body.smile !== undefined) {
    if (!isNum(body.smile)) return res.status(400).json({ error: 'invalid smile threshold' });
    thresholds.smile = body.smile;
  }
  if (body.frown !== undefined) {
    if (!isNum(body.frown)) return res.status(400).json({ error: 'invalid frown threshold' });
    thresholds.frown = body.frown;
  }
  if (body.surprised !== undefined) {
    if (!isNum(body.surprised)) return res.status(400).json({ error: 'invalid surprised threshold' });
    thresholds.surprised = body.surprised;
  }
  if (body.eyesClosed !== undefined) {
    if (!isNum(body.eyesClosed)) return res.status(400).json({ error: 'invalid eyesClosed threshold' });
    thresholds.eyesClosed = body.eyesClosed;
  }
  if (body.expressionHold !== undefined) {
    if (!isNum(body.expressionHold)) return res.status(400).json({ error: 'invalid expressionHold' });
    thresholds.expressionHold = body.expressionHold;
    console.log('[cfg] Expression hold:', thresholds.expressionHold);
  }
  if (body.exitBias !== undefined) {
    if (!isNum(body.exitBias)) return res.status(400).json({ error: 'invalid exitBias' });
    thresholds.exitBias = body.exitBias;
    console.log('[cfg] Exit bias:', thresholds.exitBias.toFixed(2));
  }

  console.log('[cfg] Thresholds updated:', thresholds);
  res.json({ success: true, thresholds });
});

// ── UDP: VTube Studio ──────────────────────────────
let vtsRecvSocket = null;
let vtsSendSocket = null;
let vtsPacketCount = 0;
let vtsSendPacketCount = 0;
let vtsKeepAliveInterval = null;
let vtsPhoneIP = null;

function bindVtsSockets() {
  // Receive socket
  vtsRecvSocket = dgram.createSocket('udp4');
  vtsRecvSocket.on('message', (msg, rinfo) => {
    vtsPacketCount++;
    const text = msg.toString('utf-8');
    if (DEBUG_UDP) {
      console.log(`[udp][vts-recv] RAW (${msg.length} bytes):`, text.slice(0, 200));
    }
    if (vtsPacketCount <= 3 || vtsPacketCount % 300 === 0) {
      console.log(`[udp] VTS packet #${vtsPacketCount} from ${rinfo.address}:${rinfo.port}`);
    }
    const shapes = parseVTubeStudio(text);
    if (shapes) {
      if (DEBUG_UDP) {
        console.log(`[blend][vts] blend shapes detected. Keys and values:`,
          Object.entries(shapes).slice(0, 8));
      }
      handleTrackingData(shapes, 'vtube_studio');
    } else if (DEBUG_UDP) {
      console.log(`[udp] VTS packet received but no blend shapes parsed (${msg.length} bytes)`);
    }
  });
  vtsRecvSocket.on('error', (err) => {
    console.warn('[udp] VTube Studio recv error:', err.message);
  });
  vtsRecvSocket.bind(VTS_RECV_PORT, '0.0.0.0', () => {
    console.log(`[udp] VTube Studio RECEIVE listening on 0.0.0.0:${VTS_RECV_PORT}`);
  });

  // Send socket (also accepts unexpected data on the send port)
  vtsSendSocket = dgram.createSocket('udp4');
  vtsSendSocket.on('message', (msg, rinfo) => {
    vtsSendPacketCount++;
    console.log(`[udp] VTS data on SEND port from ${rinfo.address}:${rinfo.port}`);
    const shapes = parseVTubeStudio(msg.toString('utf-8'));
    if (shapes) handleTrackingData(shapes, 'vtube_studio');
  });
  vtsSendSocket.on('error', (err) => {
    console.warn('[udp] VTube Studio send-port error:', err.message);
  });
  vtsSendSocket.bind(VTS_SEND_PORT, '0.0.0.0', () => {
    console.log(`[udp] VTube Studio SEND also listening on 0.0.0.0:${VTS_SEND_PORT}`);
  });
}

app.post('/api/connect-vts', (req, res) => {
  const phoneIP = req.body?.phoneIP;
  if (!phoneIP || typeof phoneIP !== 'string') {
    return res.status(400).json({ success: false, error: 'phoneIP required' });
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(phoneIP)) {
    return res.status(400).json({ success: false, error: 'invalid IP address format' });
  }

  vtsPhoneIP = phoneIP;

  const request = {
    messageType: 'iOSTrackingDataRequest',
    time: 1,
    sentBy: 'ASAdventurer',
    ports: [VTS_RECV_PORT, VTS_SEND_PORT],
  };
  const body = Buffer.from(JSON.stringify(request), 'utf-8');

  console.log(`[vts] Sending request to ${phoneIP}:${VTS_SEND_PORT}`);
  console.log('[vts] Request body:', body.toString());
  console.log(`[vts] Expecting data back on ports: ${VTS_RECV_PORT}, ${VTS_SEND_PORT}`);

  try {
    if (!vtsSendSocket) {
      return res.status(500).json({ success: false, error: 'failed to connect to VTube Studio' });
    }
    vtsSendSocket.send(body, VTS_SEND_PORT, phoneIP, (err) => {
      if (err) {
        console.warn('[vts] Send error:', err.message);
        return res.status(500).json({ success: false, error: 'failed to connect to VTube Studio' });
      }

      if (vtsKeepAliveInterval) clearInterval(vtsKeepAliveInterval);
      vtsKeepAliveInterval = setInterval(() => {
        if (!vtsPhoneIP || !vtsSendSocket) return;
        const ka = Buffer.from(JSON.stringify({
          messageType: 'iOSTrackingDataRequest',
          time: 1,
          sentBy: 'ASAdventurer',
          ports: [VTS_RECV_PORT, VTS_SEND_PORT],
        }), 'utf-8');
        vtsSendSocket.send(ka, VTS_SEND_PORT, vtsPhoneIP, (e) => {
          if (e) console.warn('[vts] Keep-alive error:', e.message);
        });
      }, 5000);

      res.json({
        success: true,
        message: `Connected to ${phoneIP}. Waiting for data on ports ${VTS_RECV_PORT}/${VTS_SEND_PORT}`,
      });
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'failed to connect to VTube Studio' });
  }
});

// ── UDP: iFacialMocap ──────────────────────────────
let ifacialSocket = null;
let ifacialPacketCount = 0;

function bindIfacialSocket() {
  ifacialSocket = dgram.createSocket('udp4');
  ifacialSocket.on('message', (msg, rinfo) => {
    ifacialPacketCount++;
    const text = msg.toString('utf-8').trim();
    if (DEBUG_UDP) {
      console.log(`[udp][ifacial] RAW (${msg.length} bytes):`, text.slice(0, 200));
    }
    if (ifacialPacketCount <= 3 || ifacialPacketCount % 300 === 0) {
      console.log(`[udp] iFacialMocap packet #${ifacialPacketCount} from ${rinfo.address}:${rinfo.port}`);
    }
    const shapes = parseIFacialMocap(text);
    if (shapes && Object.keys(shapes).length) {
      handleTrackingData(shapes, 'ifacialmocap');
    }
  });
  ifacialSocket.on('error', (err) => {
    console.warn('[udp] iFacialMocap error:', err.message);
  });
  ifacialSocket.bind(IFACIAL_PORT, '0.0.0.0', () => {
    console.log(`[udp] iFacialMocap listening on 0.0.0.0:${IFACIAL_PORT}`);
  });
}

app.post('/api/connect-ifacial', (req, res) => {
  const phoneIP = req.body?.phoneIP;
  if (!phoneIP || typeof phoneIP !== 'string') {
    return res.status(400).json({ success: false, error: 'phoneIP required' });
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(phoneIP)) {
    return res.status(400).json({ success: false, error: 'invalid IP address format' });
  }

  const handshake = Buffer.from(
    'iFacialMocap_sahuasouryya9218sauhuiayeta91555dy3719',
    'utf-8'
  );

  try {
    if (!ifacialSocket) {
      return res.status(500).json({ success: false, error: 'failed to connect to iFacialMocap' });
    }
    ifacialSocket.send(handshake, IFACIAL_PORT, phoneIP, (err) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'failed to connect to iFacialMocap' });
      }
      console.log(`[ifm] Handshake sent to ${phoneIP}:${IFACIAL_PORT} (from port ${IFACIAL_PORT})`);
      res.json({
        success: true,
        message: `Connected to ${phoneIP}. Waiting for data on port ${IFACIAL_PORT}`,
      });
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'failed to connect to iFacialMocap' });
  }
});

// ── WebSocket server ───────────────────────────────
const wss = new WebSocketServer({
  server,
  maxPayload: 64 * 1024,
});

const ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/;

wss.on('connection', (ws, req) => {
  // Origin check (browser clients). OBS browser sources may omit Origin.
  const origin = req.headers.origin;
  if (origin && !ORIGIN_RE.test(origin)) {
    console.warn('[ws] Rejected connection from origin:', origin);
    ws.close(1008, 'origin not allowed');
    return;
  }

  if (clients.size > 50) {
    ws.close(1013, 'too many connections');
    return;
  }

  const host = req.headers.host || `localhost:${PREFERRED_PORT}`;
  let clientType = 'control';
  try {
    const url = new URL(req.url || '/', `http://${host}`);
    const t = url.searchParams.get('type');
    if (t === 'overlay' || t === 'control') clientType = t;
  } catch { /* default control */ }

  ws.clientType = clientType;
  ws.isAlive = true;
  ws._msgCount = 0;
  ws._msgResetTime = Date.now();
  clients.add(ws);

  console.log(`[ws] ${clientType} connected (${clients.size} total)`);

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    // Basic flood guard
    const now = Date.now();
    if (now - ws._msgResetTime > 1000) {
      ws._msgCount = 0;
      ws._msgResetTime = now;
    }
    ws._msgCount++;
    if (ws._msgCount > 120) return;

    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'config':
        // Relay config to overlays (and other controls)
        broadcastAll({
          type: 'config',
          ...(data.sfxVolume !== undefined ? { sfxVolume: data.sfxVolume } : {}),
          ...(data.swapDuration !== undefined ? { swapDuration: data.swapDuration } : {}),
          ...(data.crossfadeMode !== undefined ? { crossfadeMode: data.crossfadeMode } : {}),
          ...(data.micThreshold !== undefined ? { micThreshold: data.micThreshold } : {}),
          ...(data.eyesClosedDelayMs !== undefined ? { eyesClosedDelayMs: data.eyesClosedDelayMs } : {}),
        });
        break;

      case 'state_override':
        broadcastAll({ type: 'state_override', override: data.override ?? null });
        break;

      case 'speaking':
        broadcastAll({
          type: 'speaking',
          speaking: !!data.speaking,
          typing: !!data.typing,
        });
        break;

      case 'webcam_tracking':
        if (data.blendShapes && typeof data.blendShapes === 'object') {
          handleTrackingData(data.blendShapes, 'webcam');
        }
        break;

      case 'expression':
        // Allow control to push expression directly if needed
        if (data.expression) {
          currentExpression = data.expression;
          broadcast({
            type: 'expression',
            expression: currentExpression,
            source: data.source || 'manual',
            smile: data.smile || 0,
            frown: data.frown || 0,
            surprised: data.surprised || 0,
            eyesClosed: data.eyesClosed || 0,
          });
        }
        break;

      default:
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] ${clientType} disconnected (${clients.size} total)`);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

// Heartbeat
const heartbeat = setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) {
      try { ws.terminate(); } catch { /* ignore */ }
      clients.delete(ws);
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 30000);

// ── Listen with port fallback ──────────────────────
function tryListen(port, attempt) {
  const onError = (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
      console.log(`  Port ${port} in use, trying ${port + 1}...`);
      server.removeListener('error', onError);
      tryListen(port + 1, attempt + 1);
    } else {
      console.error(err);
      console.error('  Close the other process or set a custom port with: PORT=XXXX node server.js');
      process.exit(1);
    }
  };

  server.once('error', onError);
  server.listen(port, '127.0.0.1', () => {
    server.removeListener('error', onError);
    const actualPort = server.address().port;

    console.log('');
    console.log('        Angel\'s  Sword  Studios');
    console.log('  ════════════════════════════════════');
    console.log(`    Control Panel:  http://localhost:${actualPort}`);
    console.log(`    OBS Overlay:    http://localhost:${actualPort}/overlay.html`);
    console.log(`    VTube Studio:   send=${VTS_SEND_PORT} recv=${VTS_RECV_PORT}`);
    console.log(`    iFacialMocap:   UDP port ${IFACIAL_PORT}`);
    if (actualPort !== PREFERRED_PORT) {
      console.log(`    (port ${PREFERRED_PORT} was busy, using ${actualPort} instead)`);
    }
    console.log('    Place your assets in: public/assets/');
    console.log('  ════════════════════════════════════');
    console.log('');

    // Bind UDP after HTTP is up
    try { bindIfacialSocket(); } catch (e) {
      console.warn(`[udp] Could not bind iFacialMocap port ${IFACIAL_PORT}:`, e.message);
    }
    try { bindVtsSockets(); } catch (e) {
      console.warn(`[udp] Could not bind VTS ports:`, e.message);
    }

    // Pick initial model
    resolveActiveModelDir();
  });
}

function shutdown() {
  console.log('  Shutting down...');
  clearInterval(heartbeat);
  if (vtsKeepAliveInterval) clearInterval(vtsKeepAliveInterval);
  try { ifacialSocket?.close(); } catch { /* ignore */ }
  try { vtsRecvSocket?.close(); } catch { /* ignore */ }
  try { vtsSendSocket?.close(); } catch { /* ignore */ }
  wss.close();
  server.close(() => {
    console.log('  Server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

tryListen(PREFERRED_PORT, 0);
