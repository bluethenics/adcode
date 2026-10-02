# ADCode launch film: 5 s for X

A 5-second launch spot with an original score. Every cut sits on a 120 BPM eighth-note grid,
and the music and sound design are synthesized to the same timestamps as the picture.

| Time | Picture | Sound |
| --- | --- | --- |
| 0.00 – 1.00 | "The IDE designed for AI." Words rise from masks on eighth notes, then the camera zooms through "AI." | A tick for each word, an Am9 pad, a riser |
| 1.00 – 2.25 | The product in 3D: AI streams ghost code, the change is accepted, and a "Your share: 50%" card lifts off the window toward the camera | Sub boom, the beat drops (F), keystrokes, a UI pop, bells |
| 2.25 – 3.75 | Whip pan. Slot-roll: *Cursor costs you. → VS Code is free. → ADCode pays you.* Shockwave and camera shake on "pays you." | Stereo whoosh, swishes, impact with a bell flourish (G → C) |
| 3.75 – 5.00 | The logo draws itself, then the wordmark, the tagline and `adcode.bluethenics.com` with a light sweep | Logo sting: boom, Cmaj9 bell strum, reverb tail |

## Files

| File | |
| --- | --- |
| `adcode-x-1080x1080.mp4` | Square, best in the mobile feed. H.264 High, 60 fps, AAC 320k |
| `adcode-x-1920x1080.mp4` | 16:9 for desktop and embeds |
| `adcode-film.html` | The picture. Every frame is a pure function of time (`window.seek(t)`). Open it in a browser to watch it loop |
| `score.mjs` | The soundtrack: pad, bass, FM bells, drums, whooshes, impacts and reverb, written in plain Node with no samples |
| `render.mjs` | Renders 4 sub-frames per frame over a 180° shutter for real motion blur, then adds film grain in ffmpeg |

## Rebuild

Needs Node, `playwright` (Chromium) and `ffmpeg`.

```
node score.mjs score.wav
node render.mjs 1080 1080 film-1080.mp4
node render.mjs 1920 1080 film-1920.mp4
ffmpeg -i film-1080.mp4 -i score.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -shortest -movflags +faststart adcode-x-1080x1080.mp4
ffmpeg -i film-1920.mp4 -i score.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -shortest -movflags +faststart adcode-x-1920x1080.mp4
```

If you move a cut in `adcode-film.html`, move the matching constant at the top of `score.mjs`
(`ZOOM`, `WHIP`, `ROLL1`, `PAYS`, `LOGO`) too.

The editor UI in the product shot is drawn in HTML, not a screenshot: the real screenshots show
account details that should not go into an ad. Fonts are Inter Tight and JetBrains Mono (SIL OFL),
the same families the website uses.
