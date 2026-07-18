=== AS Adventurer — Asset Setup ===

Place your character model folders here. Each folder is a separate "model"
that you can switch between in the Control Panel.

FOLDER STRUCTURE
================

For a single model (no folder needed):
  assets/
    neutral_idle.webm
    neutral_speaking.webm
    happy_idle.webm
    happy_speaking.webm
    sad_idle.webm
    sad_speaking.webm
    surprised_idle.webm
    surprised_speaking.webm
    eyes_closed.webm
    typing.webm              (optional)

For multiple models:
  assets/
    MyCharacter/
      neutral_idle.webm
      neutral_speaking.webm
      ...
    AnotherCharacter/
      neutral_idle.webm
      ...

IMPORTANT — exact file names
============================
Expression files MUST use these base names (extensions: .webm .mp4 .png .webp .gif):
  neutral_idle, neutral_speaking, happy_idle, happy_speaking,
  sad_idle, sad_speaking, surprised_idle, surprised_speaking,
  eyes_closed, typing (optional)

Custom names like "my_char_happy.webm" will NOT be detected unless you also
add a symlink or copy named happy_idle.webm (etc.).

FLATPAK vs source
=================
- Running from source (./start.sh): put models in this public/assets/ folder.
- Running the Flatpak: the app bundle is read-only. Personal models should NOT
  be rebuilt into the public Flatpak. Use source install for custom models, or
  place them under (if your build supports user assets):
    ~/.var/app/studio.angelsword.ASAdventurer/data/as-adventurer/assets/

PERSONAL models (do not publish)
================================
Folders gitignored / skipped from Flatpak:
  assets/Elijah/      — example personal model
  assets/_personal/   — drop any private models here
  assets/_local/      — same


EMOTES (optional)
=================
  assets/MyCharacter/emotes/
    wave/
      animation.webm         (one-shot emote, Type 1)

    sword_draw/
      intro.webm             (plays once)
      idle.webm              (loops while active)
      speaking.webm           (loops while talking)
      outro.webm             (plays on release)
      subs/
        ignition/
          animation.webm     (transition in)
          idle.webm           (loops)
          subs/
            slash/
              animation.webm (one-shot, returns to parent)
              sound.mp3

SUPPORTED FORMATS
=================
  Video: .webm, .mp4
  Image: .webp, .gif, .png
  Audio: .mp3, .wav, .ogg, .m4a

VARIANTS
========
  Multiple versions of intro/outro play randomly:
    intro.webm, intro2.webm, intro3.webm
    intro_sound.mp3, intro_sound2.mp3, intro_sound3.mp3
