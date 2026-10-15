# Football — Physics Lab 001

First executable browser prototype for an autonomous, physics-grounded football simulation.

## Run

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Open the URL printed by Vite. For a production build:

```bash
npm run check
npm run preview
```

## What the prototype actually does

- Renders a 105 × 68 m football pitch with goal frames.
- Runs a Rapier 3D rigid-body world at a fixed 60 Hz target step.
- Simulates a dynamic ball with gravity, rigid-body collisions, friction and simplified air drag.
- Runs two lightweight reactive players with bounded horizontal acceleration.
- Players independently chase the *current* ball position and attempt physical impulses on contact.
- Shows simulation time, ball speed and kick count.
- Supports pause and reset.

## Explicit limitations

This is a **physics smoke test**, not a football game or trained AI. Players are capsule bodies with simplified 3D avatars, not biomechanically simulated skeletons. Their control policy is hand-authored and their kick contact is proximity-triggered; a future version must replace this with actual foot collision geometry and calibrated impulses. Goals are visual only; there is no referee, offside, possession, out-of-play decision, keeper, real training, Azure integration, or calibrated Magnus force. The demo is not yet deployed or independently benchmarked.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md). The authoritative simulation is Rapier; rendering reads state only. Microsoft Foundry/Azure integration is a later milestone for grounded tactical explanation and match analysis.

## Next validation

1. Run `npm run check` and test the page in a browser.
2. Record FPS, tick rate, collision stability and penetration issues.
3. Add physical foot contact, explicit player observation/action boundaries, and automated physics tests.
4. Ground AI commentary in simulation events; do not allow cloud models to determine physical outcomes.
