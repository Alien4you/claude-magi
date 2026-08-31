# Sound cues

The plugin ships **no audio**. By default every cue is synthesized at runtime
by `lib/sound.mjs`, so MAGI works with an empty directory.

Drop a file here named after a cue and it is played instead of the synthesized
one. Accepted extensions: `.wav`, `.mp3`, `.aiff`, `.aif`, `.m4a`, `.ogg`.

| File | Plays when |
|------|-----------|
| `boot` | the terminal powers up |
| `tick` | each unit comes online |
| `affirm` | a unit returns 肯定 / APPROVE |
| `negate` | a unit returns 否定 / REJECT |
| `withhold` | a unit returns 保留 / ABSTAIN |
| `klaxon` | a unit dissents from the majority |
| `approved` | the final 可決 stamp |
| `rejected` | the final 否決 stamp |

So `sounds/klaxon.wav` replaces the synthesized klaxon and nothing else.

Point at a different directory with `--sounds <dir>` or `MAGI_SOUND_DIR`.

Anything you add here is git-ignored: these files are yours and are not part of
the project. If you are cutting clips from media you own, `ffmpeg` does it:

    ffmpeg -i /path/to/your/source.mkv -ss 00:04:12.0 -t 2.5 -ac 1 sounds/klaxon.wav
