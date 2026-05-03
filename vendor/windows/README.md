# Windows Runtime Assets

Place offline installer runtimes here before building the Windows installer:

- `vendor/windows/node/node.exe` plus the rest of the portable Node.js x64 runtime.
- `vendor/windows/ffmpeg/bin/ffmpeg.exe` plus the rest of the FFmpeg x64 runtime.

These binary folders are intentionally gitignored. The Windows installer build
can also use `PREMIERSEYO_NODE_WIN_DIR` and `PREMIERSEYO_FFMPEG_WIN_DIR` to point
at runtime folders outside the repo.
