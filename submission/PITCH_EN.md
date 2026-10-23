# THE 12TH MAN – Pitch

**Coach the moments that matter, and see why they mattered.**

## The problem

Live football data is everywhere, but most of it reports *what* happened, such as possession, shots and a scoreline. Fans want to understand *why* a moment matters. Analysts want the numbers behind it. Both usually get the same flat stats ticker, and nobody gets to feel the weight of a decision.

## What we built

THE 12TH MAN is a complete, synthetic 11-v-11 football match that plays itself in the browser, with a coaching layer and an explainable match-intelligence layer on top.

- **Autonomous players on real physics.** 22 player agents, each with their own perception, abilities and character (risk, team play, discipline, confidence). They play on a Rapier physics simulation with ball, body and boot contacts at 240 Hz, under an independent IFAB referee. Every pass, shot, tackle and goal is a real event in that simulation; nothing is scripted.
- **The orchestrator: you are the 12th man.** The match stops only when there is a real choice, such as a risky pass, a take-on, a counter or not, the wall at a free kick, a corner routine, which corner to take a penalty, a substitution or the half-time talk. Each option is executable and carries the players' own estimate of success. You choose; the players try. Whether it works is decided by feet, ball and opponents, and a consequence card tells you what really happened.
- **Match intelligence in five stages:** ingest → interpret → explain → render → personalize.
  - Synthetic events become statistics:
    - passes with distance, completion and a 1–5 difficulty rating;
    - shots with speed and model xG;
    - possession, territory and turnovers by zone;
    - pressure on the ball carrier;
    - distance, top speed and sprints per player.
  - Patterns and moments are explained:
    - how each goal was built;
    - big chances and saves;
    - which team is on top and why;
    - control or chaos;
    - a high press that works;
    - what came of your decision.
  - In a decision scene, *why it matters* names who presses the player, how open each passing lane is and how much the safest and the boldest option differ.
- **Two genuinely different experiences.**
  - **Fan mode** tells one story at a time, shows who is on top and follows your favourite player.
  - **Analyst mode** shows the full table and an insight feed in which every statement cites the event IDs it is based on.
  - Both work in English and German. You also choose your club and a focus player, who gets a name tag in the picture that shows his speed when he sprints.
- **Machine-readable output.** At full time the whole intelligence can be downloaded as a versioned, timed JSON feed (`the12thman.intel/v1`). The `npm run intel` script exports any seeded match as an event log plus intelligence feed, which is a reusable synthetic dataset.

## What makes it different

- **Explanations you can check.** Every insight keeps its numbers and its source events. Tests verify that every cited event exists and that goals, shots and possession changes agree with an independent statistics module. The optional AI narration is guarded: an answer containing a number that is not in the facts is rejected.
- **Decisions with real consequences.** The intelligence explains and compares, but it never decides an outcome. The simulation is the single writer of the match state.
- **Made for broadcast and streaming.** A 2 × 15 session takes about 7 minutes, measured in a production build with 12–13 decisions. Quiet phases are condensed, never skipped: every simulated second is computed.

## Microsoft technologies

| Technology | Status |
| --- | --- |
| **Microsoft Foundry** (model narration of insights) | **Prepared, not deployed.** An Azure Function (`api/`) calls a Foundry model through `@azure/ai-projects` with a managed identity (no key). It validates and rate-limits requests and rejects answers containing invented numbers. The core logic is unit-tested; the Azure resources are not created yet, so the demo runs with local narration. |
| **GitHub** (repository, Actions) | Public repository; a GitHub Actions workflow that tests, builds and deploys the static demo to GitHub Pages (manual start). |

*If the Foundry narration is deployed before submission, update this table with the live endpoint and show it in the video.*

## Technical summary

TypeScript, Three.js and Rapier 3D (WASM). The simulation runs in a Web Worker and is deterministic per seed. A static site with no backend is required to play. 164 automated tests (plus 4 opt-in long runs: full match, shot lab, scene recording, intelligence export), real-browser checks with screenshots, and measured session times and frame rates are documented in [PROJECT_REPORT.md](../PROJECT_REPORT.md).

## Who it is for

- Broadcasters and streaming platforms that want explained, personalised second-screen intelligence.
- Clubs and fan apps that want to let fans feel coaching decisions.
- Analysts and educators who want a reproducible synthetic match with a full event log.
