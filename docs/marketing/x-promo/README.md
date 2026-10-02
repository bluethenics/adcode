# X promo — 5 s motion piece

A 5-second motion design for an X post: *the IDE designed for AI — Cursor makes you pay,
VS Code is $0, ADCode pays you (50% of ad revenue)* → logo lockup and `adcode.bluethenics.com`.

| File | Use |
| --- | --- |
| `adcode-x-1080x1080.mp4` | Square, best in the mobile timeline. H.264, 60 fps, 5.0 s |
| `adcode-x-1920x1080.mp4` | 16:9, for desktop / link previews |
| `adcode-promo.html` | The source. Open it in a browser to watch it loop live |
| `render.mjs` | Renders frames with Playwright and encodes with ffmpeg |

Re-render after editing the HTML (needs `playwright` and `ffmpeg`):

```
node render.mjs 1080 1080 adcode-x-1080x1080.mp4 60
node render.mjs 1920 1080 adcode-x-1920x1080.mp4 60
```

Every frame is a pure function of time (`window.seek(t)`), so renders are deterministic.
Fonts are Inter Tight and JetBrains Mono (SIL OFL), the same families as the website.
