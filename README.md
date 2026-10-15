# Football — Autonomous Match 002

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

- Three.js 3D pitch, 42 × 28 m small-sided test field with visible goals
- Rapier 3D ball and dynamic player capsules, fixed 60 Hz target timestep
- Three orange vs three blue reactive agents, bounded acceleration and support positioning
- Kick attempts via impulses, simple drag, goal detection, scoreboard, kickoff reset
- Pause, restart, time, ball speed and shot counter

## Not yet implemented

Trained AI, physical foot geometry (kicks are currently triggered by proximity), realistic animation, calibrated aerodynamics, full football rules, robust goal-frame collision, advanced tactics, Microsoft Foundry integration, replay, automated physics verification and public deployment. The first version is intentionally a rough gameplay test; do not mistake it for a complete football simulator.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the broader research and design backlog.
