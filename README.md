# THE 12TH MAN — Autonomous Matchday

Browser prototype of a physically grounded, autonomous football match for the Microsoft × Premier League hackathon.

## Start locally

```powershell
cd D:\football
git pull
npm install
npm run check
npm run dev
```

Open the Vite URL in the browser.

## Implemented (prototype)

- 11 v 11 with goalkeepers on a 105 × 68 m IFAB pitch; posts, crossbar and net are physical colliders
- Rapier 3D (SIMD build) as the single physics authority, fixed 60 Hz step, substeps during strikes
- Physical boot/ball contacts: each player has two kinematic boot colliders driven by a bounded leg swing; passes, shots, dribbles, clearances and first touches only happen if the boot really meets the ball
- 4-3-3 positional play, coach tactic (high press / deep block), ball winner per team, offside-line discipline
- Referee: goals (whole ball over the line), throw-ins, corners, goal kicks, kickoffs, offside, 9.15 m distance
- Match event log, contact diagnostics overlay (button KONTAKTE), stadium, intro, HUD
- `npm run check` = typecheck + build + Vitest suite (contact physics, rules, motion bounds, "no magnetism")

## Not yet implemented

Decisive-moment detection and the user decision UI (the engine already accepts user intents via `Match.setUserIntent`), keeper hands and dives, fouls and cards, perception limits for agents, Magnus effect, calibrated rolling resistance, replay, Microsoft Foundry integration, real player models and public deployment.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the broader research and design backlog.
