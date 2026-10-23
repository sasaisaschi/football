# Demo video – script and edit (≤ 115 s)

All footage is real screen capture of the production build in Chrome at 1600 × 900. It is recorded by `scripts/video/record-demo.mjs` and cut by `scripts/video/build-video.mjs`. No music and no third-party marks; the clubs and players are fictional. The captions are burned in, so the video works without sound.

The voice-over below is optional. If it is recorded, it follows the caption timing.

| Time | Picture (source marker) | Caption on screen | Voice-over (optional) |
| --- | --- | --- | --- |
| 0:00–0:06 | Title card over the stadium (start screen) | **THE 12TH MAN** – coach the moments that matter. Explainable match intelligence from synthetic football. | "This is THE 12TH MAN – a football match you coach at the moments that matter." |
| 0:06–0:16 | Start screen: club, Fan/Analyst, focus player, 2 × 15 min (`start`) | Pick your club, your view and a player to follow. | "Pick your club, how you want the story told, and a player to follow." |
| 0:16–0:34 | Live play, fan mode: story card, "who is on top" bar, name tag of the focus player (`kickoff` + 10 s) | 22 autonomous players, real ball physics, an independent referee – every event is synthetic and real. | "Twenty-two autonomous players on real physics. Nothing is scripted – every pass and shot is a real event." |
| 0:34–0:52 | First decision: frozen scene, "Why it matters", options with lanes and estimates (`moment-1`) | The orchestrator stops only at real choices – and explains why this one matters. | "When there is a real choice, the match freezes. The intelligence explains who is pressing, which lanes are open, and how risky each option is." |
| 0:52–1:04 | Choice by key, the play unfolds, consequence card, fan card "Your call" (`decision-1`) | You decide. The players try. The consequence card shows what really happened. | "I choose. The players try – feet, ball and opponents decide. And we see what really came of it." |
| 1:04–1:24 | Switch to analyst mode with `I`: statistics table, insight feed citing event IDs, focus player card (`analyst`) | Analyst mode: passes, difficulty, xG, pressure – every insight cites the events it rests on. | "Analysts get a different experience: pass difficulty, model xG, pressing success – and every statement cites its source events." |
| 1:24–1:34 | A goal or a big moment with its story (`insight-goal` or next decision) | Goals are explained: where the move began, how many passes, the shot. | "Every goal comes with its story." |
| 1:34–1:48 | Full time: match report and JSON download (`result`) | Automated match report, plus a machine-readable intelligence feed. | "At full time: an automated report, and the whole intelligence as a timed JSON feed for overlays." |
| 1:48–1:55 | End card | Ingest · Interpret · Explain · Render · Personalize. Microsoft Foundry narration: see repository status. github.com/sasaisaschi/football | "Ingest, interpret, explain, render, personalize. THE 12TH MAN." |

## Microsoft integration shot

**If the Foundry narration is deployed** (see `api/README.md`), replace 1:24–1:34 with analyst mode showing a card marked *"Worded by Microsoft Foundry"* and the status line *"AI narration (Microsoft Foundry): on – n answers"*. Then change the end card to: *"Narration by a Microsoft Foundry model, guarded against invented numbers."*

**If it is not deployed**, the video must not claim it. The analyst status line then reads *"AI narration (Microsoft Foundry): off"*, and the end card points to the repository status.

## How to rebuild

```bash
npm run build
node scripts/video/record-demo.mjs --seed 11 --half 5      # writes video-output/frames + markers.json
node scripts/video/build-video.mjs                          # writes video-output/the-12th-man-demo.mp4 (needs ffmpeg)
```
