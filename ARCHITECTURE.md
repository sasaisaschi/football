# FOOTBALL — Architecture & Research Backlog

**Status:** Draft for review, not an approved implementation specification  
**Date:** 2026-10-15  
**Repository:** https://github.com/sasaisaschi/football  
**Goal:** Microsoft × Premier League *Inside the Game* hackathon submission; validate official rules, category and deadline before submission.

> **Design principle:** We do not script match outcomes. We create a physically consistent world in which autonomous football agents perceive, decide, act and learn. The coach influences tactics, not individual ball trajectories.

## 0. Decision register

| Topic | Current position | Status |
|---|---|---|
| Core concept | Emergent football from autonomous agents + continuous physics | Agreed vision |
| First user perspective | Coach / touchline; player perspective remains an architectural option | Proposed hackathon scope |
| Primary runtime | Browser, TypeScript | Candidate |
| Physics | Rapier 3D as single authoritative rigid-body solver | Candidate; benchmark required |
| Football research reference | Google Research Football (GRF), not a second concurrent physics engine | Candidate; audit required |
| Renderer | Three.js or Babylon.js, physically separate from simulation | Open |
| AI | Hybrid fast local controllers + slower LLM tactical/analysis agents | Candidate |
| Microsoft services | Foundry/Azure AI for tactical reasoning, event explanation and commentary; hosting optional | Verify current SDK, pricing, eligibility |
| Repository | Public GitHub | Verified 2026-10-15 |
| Source of truth | This file until decisions are promoted to ADRs / PROJECT_REPORT.md | Proposed |

**Do not interpret this backlog as approval to implement every item.** Mark each item Keep / Later / Reject after review. Avoid hidden scope growth.

## 1. Product vision and non-negotiable invariants

- A match unfolds **during play**, not as a precomputed scoreline followed by animation.
- Agents issue **attempted physical actions** (accelerate, turn, strike, block, jump); physics determines the resulting contacts, motion and outcome.
- No privileged teleportation, ball-target snapping, guaranteed pass success, scripted goal probability or canned play outcome.
- The referee/rules layer is authoritative for legal game state, but cannot override physical trajectories to force a desired result.
- Every agent has a perception boundary. An agent must not use perfect global information unless explicitly modeled as a game accessibility/debug mode.
- The same physics applies to corners, free kicks, shots, passes, dribbles, headers, goalkeeper saves and tackles.
- Balance first: believable ball physics + believable locomotion + believable contacts together, rather than one hyperreal subsystem beside broken ones.
- Simulated world state is independent of graphics, replay, commentary, and Microsoft cloud availability.
- The system should scale conceptually from 2 agents to 4 and ultimately 22 without rewriting its fundamental world model.
- User roles may eventually include coach and player, but avoid building both full control schemes in the first hackathon slice.

## 2. Competition alignment — verify against official current rules

Research and record: exact event name; category and required Azure/Microsoft services; registration and submission deadlines/time zones; public-repo, demo/video, licensing and judging requirements; whether event streams must be synthetic; whether a hosted test demo is required. Keep direct source URLs and access dates.

**Potential differentiator:** agent-generated, physically caused synthetic football events → explainable match narratives, tactical insights, coach interaction and replay. The physics sandbox alone may not satisfy the challenge; the AI explanation layer must be visible and assessable.

Useful starting points (not a substitute for verifying requirements):
- https://aka.ms/insidethegame
- https://github.com/microsoft/insidethegamehackathon
- https://learn.microsoft.com/en-us/azure/ai-foundry/

## 3. Architecture — candidate logical layers

```text
Human coach (instructions / strategy)
                 |
       Tactical reasoning agent(s)  <---- Microsoft Foundry (candidate)
                 |
       Team plans / tactical constraints
                 |
      Individual player agents (N)
     perception -> intention -> control
                 |
   Motor/action adapter (bounded physical commands)
                 |
     AUTHORITATIVE SIMULATION WORLD
   fixed-step clock | Rapier 3D | football forces
   bodies | ball | contacts | sensors | rules
                 |
   state snapshots + append-only event stream
           /                  \
      3D renderer       analysis/commentary
      and replay        Azure AI (candidate)
```

**Single-writer rule:** Only simulation core mutates authoritative position/velocity/contact state. Cloud agents return intents, analysis or commentary, never physically authoritative outcomes. Rendering interpolates snapshots and must not feed back unvalidated physics state.

### 3.1 Time scales (starting hypotheses, benchmark before locking)

- Physics: fixed 1/60 s or 1/120 s with capped catch-up; do not tie to display FPS.
- Motor control: 20–60 Hz.
- Tactical local decisions: 2–10 Hz, with event-triggered reconsideration.
- LLM/coach reasoning: asynchronous, infrequent, non-blocking; graceful fallback.
- Render: independent animation loop with interpolation.
- Avoid one LLM call per player per physics frame.

### 3.2 Coordinate conventions

- SI units: meters, kilograms, seconds, radians.
- Explicit world axes (candidate: X field length, Y field width, Z height); document engine coordinate transforms.
- Origin at pitch center; candidate 105 × 68 m pitch means X ∈ [-52.5,52.5], Y ∈ [-34,34].
- Goal-line planes at X = ±52.5; centerline X = 0.
- Keep pitch geometry configurable; distinguish IFAB permitted ranges from our chosen default.
- Use deterministic random seeds where feasible; verify platform determinism rather than assume it.

### 3.3 Core modules (logical boundaries, not mandatory folder count)

- `config`: field, ball, rules and player presets.
- `sim`: world, clock, physics adapter, force models, collision/contact resolution.
- `agents`: perception, tactical intent, locomotion, kicking, goalkeeping.
- `rules`: goal/out-of-play/restarts/offside/fouls; progressive implementation.
- `events`: structured immutable event records, state snapshots, replay.
- `render`: camera, 3D pitch, player visuals, debug overlays.
- `azure`: tactical reasoning, match explanation, commentary, telemetry adapters.
- `ui`: coach input, replay controls, diagnostics.
- `tests`: physics, integration, agent, performance and regression.

**Repository convention:** lowercase directories; React TSX/CSS under `src/components`; no Tailwind; prefer CSS with precise layout. Do not create placeholder abstraction layers unless used.

## 4. Rapier 3D — technical investigation

Primary: https://rapier.rs/docs/ ; https://github.com/dimforge/rapier ; https://www.npmjs.com/package/@dimforge/rapier3d-compat

Audit:
1. Current stable npm version, ESM/Vite/WebAssembly initialization, browser and headless test support.
2. Rigid-body sphere, capsule, compound colliders, restitution/friction, sensor volumes.
3. Continuous collision detection for fast ball vs thin goalposts.
4. Contact manifolds, collision events, impulses and torque.
5. Character controller vs dynamic-body locomotion: trade-offs for pushing, slipping, falling and football realism.
6. Solver timestep, stability, substepping, profiling and deterministic build variant.
7. Force application per tick for gravity, drag and Magnus effect.
8. Serialization/snapshots/replay and numerical divergence.
9. License, deployment size and browser performance on ordinary Windows hardware.

**Caution:** Rapier does not supply football intelligence, muscle control, aerodynamics, a football rule engine or realistic foot placement automatically. Avoid claiming those features exist.

## 5. Google Research Football — technical investigation

Primary: https://github.com/google-research/football

Audit:
1. Archive/maintenance status and license.
2. C++ engine architecture, Python API, dependency age, Windows support and reproducible builds.
3. Action vocabulary (direction, sprint, pass, shot, tackle), action frequency and control abstractions.
4. Raw observations, ball position/velocity/spin, player states and game-mode events.
5. How physics is implemented and whether physically meaningful foot-ball contacts are exposed.
6. Agent training scenarios, rewards, baseline models, reproducible seeds and replay.
7. Whether specific concepts/data/interfaces can be reused without incorporating GRF runtime.
8. Verify any reuse under actual license and dependency obligations.

**Integration rule:** Do not run GRF physics and Rapier physics as simultaneous authorities for the same ball. Use GRF as a reference/test baseline unless a stronger alternative is demonstrated.

## 6. Real football data and authoritative geometry

- IFAB Laws of the Game: https://www.theifab.com/laws/latest/
- Metrica tracking samples: https://github.com/metrica-sports/sample-data
- StatsBomb open event data: https://github.com/statsbomb/open-data
- SkillCorner open tracking/pose data: https://github.com/SkillCorner/opendata
- Google Research Football as behavioral baseline.

**Initial pitch preset** (confirm against current IFAB Laws): length 105 m; width 68 m; goal width 7.32 m; crossbar 2.44 m above ground; penalty-area depth 16.5 m; goal-area depth 5.5 m; penalty mark 11 m; center-circle radius 9.15 m; corner arc radius 1 m. Ball circumference 68–70 cm; mass 410–450 g at start.

Data quality checklist: coordinate systems; timebase/sampling; anonymization; ball visibility gaps; inferred velocities vs measured velocities; licenses; commercial reuse; uncertainty; source version. Tracking samples are **not** physics engines or direct evidence of collision/contact coefficients.

## 7. Physics model — balanced minimum viable realism

### 7.1 Ball
- Gravity and rigid-body contacts (ground, post, player).
- Rolling resistance, sliding friction, bouncing and angular damping.
- Aerodynamic drag: `F_d = -0.5 * rho * Cd * A * |v| * v`.
- Spin / Magnus lift: model and coefficient must be calibrated, not invented as universal truth.
- Ball-foot/head contact: collision point, relative velocity, impulse, torque, contact duration approximation.
- Test shot, chip, ground pass, curl, deflection, post and keeper save using same implementation.

### 7.2 Players
- Height, mass, reach, foot side, stride, acceleration, braking, turning radius, balance and stamina.
- Avoid instant velocity or heading changes.
- Locomotion as bounded control forces / physically plausible movement, not teleportation.
- Collision shape trade-off: capsule for first slice; articulated body later if justified.
- Jump and header need real collision/impulse geometry; visual animation alone is insufficient.
- Keeper uses the same world physics with specialized policy/reach/pose constraints.

### 7.3 Rules
- Field boundaries, goals, out of play, possession and restarts first.
- Offside and fouls are complex and must not be faked as mere collision detection.
- Rule decisions must be inspectable in an event log.

### 7.4 Validation
- Ball drop: rebound height/energy and penetration.
- Rolling ball: distance vs friction, stop behavior.
- Free kick: speed, curvature and flight time vs published measurement ranges.
- Player sprint and stop: speed/acceleration curves vs tracking-derived bounds.
- Contact: no unbounded energy creation, no tunneling, no ball sticking to foot.
- Two-player interception: agents react to live ball state; no pre-scripted outcome.
- Repeated seeds and perturbation tests; distinguish genuine adaptive behavior from random variation.
- Test *combined* quality: locomotion, contact and ball physics in the same scenario.

## 8. Agent architecture

**Perception:** visible/estimated ball and player positions, occlusion, distance, facing, latency, uncertainty, teammate communication; avoid perfect omniscience by default.

**Decision hierarchy:**
- Coach: tactical principles and instructions (pressing, defensive line, risk).
- Team layer: formation, marking and role allocation.
- Individual policy: seek space, intercept, pass, shoot, protect, press.
- Motor layer: acceleration, turn, step, jump, contact attempt.
- Physics: computes outcomes.
- Rule engine: determines legal state.

Training options to research: imitation learning from tracking, reinforcement learning in controlled scenarios, utility/GOAP policies as initial baselines, curriculum from 1v0 → 1v1 → 2v2 → 11v11. Training feasibility, compute budget and generalization remain unproven.

Example intent contract (conceptual only):
```ts
type AgentIntent =
  | { kind: "move"; target: [number, number]; urgency: number }
  | { kind: "kick"; foot: "left" | "right"; desiredDirection: [number, number, number]; effort: number; spinIntent: number }
  | { kind: "jump"; effort: number }
  | { kind: "block"; direction: [number, number] };
```
**An intent does not guarantee contact, accuracy or success.** Convert it to constrained physical actions, then simulate.

## 9. Microsoft / Azure integration research

Do not pick a service solely to satisfy branding. Confirm **official hackathon service requirements** and current documentation first.

Candidates to validate:
- Microsoft Foundry (Azure AI Foundry): models, agent service, tool/function calling, managed identity, quotas and SDKs.
- Azure OpenAI / Foundry Models: tactical reasoning and grounded explanations from structured simulation events.
- Azure Container Apps or Azure Static Web Apps: backend or frontend hosting if needed.
- Azure Functions: event processing, summaries and demo endpoints if useful.
- Azure Application Insights: diagnostics, costs and latency.
- GitHub Actions + Azure deployment: CI/CD, secrets and smoke tests.

**Proposed agentic differentiation:**
1. A coach agent interprets natural-language tactical requests into bounded, inspectable tactics.
2. A match analyst consumes *actual simulated events* and state snapshots, explaining why an opportunity arose.
3. A commentator generates concise grounded live narrative; no invented ball contacts or goals.
4. Optional post-match analyst summarizes possession, interceptions, chance creation and tactical changes.

**Reliability:** cloud outage must not freeze physics. Async requests use timeouts/fallbacks configurable in UI; avoid hidden hard-coded limits. Azure credentials stay server-side, never in browser bundles. Measure token costs and API latency. Avoid deploying expensive always-on infrastructure for a demo.

## 10. Frontend / visualization

Candidate stack: React + TypeScript + Vite; Three.js or Babylon.js (choose after benchmark); Rapier WebAssembly; plain CSS. Rendering is observational, not physically authoritative.

Coach view: 3D pitch, selectable camera, real-time players/ball, tactical input, live event feed, agent decision inspector, trajectory debug overlay, pause/step/replay. UI should progressively reveal complexity.

Accessibility: keyboard control, legible overlays, low-end graphics mode. A replay should come from snapshots/events, not fabricated highlight clips. AI-generated cinematic highlights may be a later optional renderer, never a physics source.

## 11. MVP: one coherent vertical slice

**First executable test:** browser-hosted 105 × 68 m pitch; gravity; ball; two autonomous players with bounded locomotion; player A approaches and attempts a kick, player B independently intercepts; genuine collisions; live 3D view; debug velocity vectors; repeatable seed; simple event stream.

**Acceptance gates:**
- Physics is the sole source of ball position.
- No ball teleportation or guaranteed pass outcome.
- Both players obey bounded acceleration/braking.
- Collision and fast-ball CCD behave acceptably.
- The scenario runs at a stable measured tick rate on target hardware.
- Simulation remains playable with Azure disconnected.
- Event log and replay agree with actual physics.
- Basic tests are green.

**Next slice:** goal + goalkeeper + goal/out-of-bounds events; then free kick with wall; then 2v2; expand only after the combined baseline is stable.

**Hackathon showcase:** coach instructs agents; unscripted play generates events; Microsoft AI explains what happened with source event IDs and tactical rationale. Clearly distinguish implemented features from planned ones in README/demo.

## 12. Proposed initial repository layout (subject to review)

```text
football/
  ARCHITECTURE.md
  README.md
  package.json
  src/
    app/
    components/
      pitch/
      coach/
      diagnostics/
    sim/
      world/
      physics/
      ball/
      players/
      rules/
      events/
    agents/
      perception/
      decisions/
      control/
    azure/
    render/
    config/
  tests/
    physics/
    integration/
    performance/
  docs/
    research/
    decisions/
  .github/
    workflows/
```

Avoid creating empty directories until there is actual code. Do not add Supabase, databases, Kubernetes or a complex microservice topology without a demonstrated need.

## 13. Build and delivery sequence

**Phase 0 — Research gate:** verify official competition rules, licenses, Rapier browser setup, GRF constraints, Foundry SDK, expected Azure costs.

**Phase 1 — Boot:** initialize Vite/React/TypeScript, lint, typecheck, unit tests, GitHub Actions, minimal README. Run a clean production build.

**Phase 2 — Balanced physics benchmark:** Rapier world, pitch, ball, two agents, collisions, bounded acceleration, debug visualization, deterministic-ish repeat test and performance metrics. Publish findings and limitations.

**Phase 3 — Autonomy:** perception → decision → constrained motor actions; prove reactive interception vs scripted playback.

**Phase 4 — Events:** immutable match event schema, goal/out-of-bounds, replay and diagnostics.

**Phase 5 — Microsoft:** Azure/Foundry tactical analyst and commentator consuming real events; grounding, cost and failure handling.

**Phase 6 — Submission:** deployed demo, English README, architecture diagram, setup, service disclosure, 2-minute demo video, limitations, license and deadline checklist.

**Verification command (target):** `npm run check` = structure + lint + typecheck + tests + build; do not declare green until run.

## 14. Research questions to resolve before substantial coding

1. Which exact hackathon category are we entering, and what Microsoft services are mandatory?
2. Rapier deterministic build or standard build? What measured performance on target browser?
3. Kinematic controller vs dynamic-body player movement: which yields credible collisions?
4. Can we use a rigid-body ball with externally applied drag/Magnus each tick without solver instability?
5. How to model foot contact at hackathon fidelity without full skeletal dynamics?
6. Which renderer provides acceptable FPS, camera quality and fastest implementation?
7. Which tracking source can legally inform locomotion parameters?
8. Which Azure model and agent SDK meet quota/cost/latency constraints?
9. How will we demonstrate *autonomy*, not merely random movement?
10. How will we demonstrate balanced quality across ball, locomotion and contacts?
11. What is explicitly out of scope for submission (full 11v11, transfer market, advanced biomechanics, photorealistic video)?
12. Which components must be deployable for the jury without requiring private API credentials?

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Beautiful ball physics, poor player motion | Combined acceptance benchmark from day one |
| Physics and rendering drift | Single authoritative simulation state |
| Cloud AI latency/cost | Async high-level agents; local fast controllers; fallback |
| Hallucinated commentary | Ground all claims in event IDs/snapshots |
| GRF outdated build/dependencies | Reference only unless proven useful |
| Unrealistic contact/animation | Instrument impulse and collision tests; document limits |
| Browser performance | Fixed timestep, interpolation, profiling and quality presets |
| Scope explosion | Keep/Later/Reject review; incremental playable slices |
| Missed competition requirements | Validate official rules and submission checklist first |
| Data rights | Track license/provenance per dataset |

## 16. Review checklist — decide before implementation

- [ ] Approve/revise core vision and first coach perspective.
- [ ] Verify official hackathon rules and Azure obligations.
- [ ] Approve Rapier for **benchmark**, not irrevocable commitment.
- [ ] Choose renderer after minimal performance comparison.
- [ ] Define first 2-player scenario and measurable acceptance criteria.
- [ ] Set minimum Microsoft integration demonstrating agentic value.
- [ ] Mark backlog items Keep / Later / Reject.
- [ ] Begin Phase 1 only after review.

---

**Architectural north star:** *We do not simulate the outcome of a football match. We simulate the world in which autonomous agents play football.*


## 17. Product vision recovered — THE 12TH MAN / MATCHDAY (2026-10-15)

**Origin:** Earlier concept conversation of 2026-10-14. This section restores previously omitted product intent; it does not claim that the features are implemented.

### 17.1 What we are building
THE 12TH MAN is an interactive, cross-generational **football matchday experience**, not a FIFA clone or a laboratory for polygon-based player models. The core emotional reference is English football culture: the pub before kickoff, the walk to the ground, chants, club identity, family/community, the tension of a chance and the collective explosion of a goal. Football is an entire shared day, not merely a ninety-minute animation. Manager-like tactical agency and the desire to participate personally belong together.

The opening experience must communicate the vision instantly through **sound, storytelling, crowd behavior, perspective and human participation**, not through developer counters, placeholder cylinders or technical controls. The stadium should feel alive before any simulation details are exposed.

### 17.2 Five originally conceived roles
- **Match Director:** orchestrates matchday story and audiovisual presentation based on real events.
- **Football Manager:** supports tactics, club decisions and coach interaction; cannot script outcomes.
- **Pub Host:** creates pre-match community and football culture; conversational/spoken experience.
- **Crowd Director:** dynamic chants, crowd reactions, tension and celebrations.
- **Match Analyst:** explains events and tactical causes from real simulation data, without inventing evidence.

These are **product/agent responsibilities**, not necessarily five separate expensive cloud models or continuously running LLM instances. Prefer event-driven, shared model access and deterministic local systems for immediate reactions.

### 17.3 Low-resource creative direction
The project has **finite compute, time and money**. Avoid a commitment to twenty-two photorealistic skinned 3D humans or a high-poly stadium. Evaluate composited stadium photography, image layers with parallax, 2.5D sprites / multi-angle player frames, camera direction, recorded or procedurally mixed stadium audio, event-driven short clips and adaptive soundscapes. No claim that single images provide arbitrary 3D rotations or physically correct foot contacts. Visual layers follow authoritative physics, never override it.

**Mobile phone as a possible participation and production surface:** explore phone-based capture of crowd/chant/ambient sound, simple audio sampling, voice contribution, companion experience, shared cheering and inexpensive authentic matchday media. The exact mobile use case is not yet a settled implementation decision; check consent, recording rights and latency before implementation. Phones are not assumed to provide unlimited compute or energy.

### 17.4 Experience sequence to prototype before additional physics cosmetics
1. **Arrival / anticipation:** club identity, soundscape, approaching the ground, social atmosphere.
2. **Stadium reveal:** immediate compelling establishing shot, chanting crowd, floodlights and pre-kickoff energy.
3. **Live unscripted match:** independent player agents and single authoritative physical state; accessible broadcast rendering.
4. **Emotional match direction:** crowd and commentary react to real chances, tackles, corners and goals; never fabricate them.
5. **Participation:** coach/manager voice or natural-language tactical choices, optional audience interaction.
6. **After the whistle:** analyst, narrative, memories, highlights tied to actual recorded match events.

### 17.5 Non-negotiable creative checks
- First thirty seconds must evoke a matchday, not a physics debugger.
- Visual approach must be chosen against available hardware and production resources, not industry convention.
- Authentic sound and timing may contribute more immersion per unit of compute than geometric complexity.
- Never present technical prototypes as finished football characters or broadcast quality.
- Preserve physical truth and event provenance even when presentation is cinematic.
- Separate **agreed original vision**, **candidate implementation**, and **implemented/tested reality**.

### 17.6 Current gap
As of 2026-10-15, the repository contains an early 3v3 Rapier/Three.js prototype, a geometric stadium, broadcast overlay and an optional GLB loading pipeline. **It does not implement the matchday journey, Pub Host, Crowd Director, authentic audio library, cinematic image compositor or credible player animation assets.** Do not keep polishing the geometric prototype as a substitute for this vision.

### 17.7 Working agreements
- Local `npm run check` is the verification workflow; **do not add GitHub Actions/workflows without explicit user approval**.
- Re-read this vision before major implementation. Prioritize decisive experiential improvements over superficial iteration.
- Treat architecture candidates in earlier sections (including GitHub Actions) as **not approved** when they conflict with these explicit agreements.
