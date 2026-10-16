# Application archive — 2026-10-16

The source files under `source/` are preservation copies, not executable build inputs. The original `src/` files remain authoritative.

Copied and verified through GitHub commits:
- `source/main.ts.txt` from `src/main.ts`
- `source/stadium.ts.txt` from `src/stadium.ts`
- `source/player-visuals.ts.txt` from `src/player-visuals.ts`
- `source/index.html.txt` from `index.html`
- `source/package.json.txt` from `package.json`
- `assets/crowd-stand.svg.txt` from `public/assets/stadium/crowd-stand.svg`

Not yet archived here: `src/style.css`, root README/VISION/ARCHITECTURE docs, potential other files, binary assets, Git history. Connector safety checks blocked copying some of these; the originals remain in Git.

The JSON catalogues in `public/data/` cover physics, football rules, mobile capabilities, visual production, agents, crowds, and asset inventory. They do not replace executable source or real media files.

**Security and preservation:** Everything under `public/` can be served by Vite. Never place secrets there. Archive copies can become stale after future source changes. A Git clone, including all tracked files and history, remains the reliable project backup.
