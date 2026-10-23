# Submission checklist – THE 12TH MAN

Source of the requirements: [Official Rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md), read on 22.10.2026.

**Deadline:** 27.10.2026, 11:59 pm PT, which is 28.10.2026, 07:59 CET. Testing access must stay available until the end of judging, 10.11.2026, 11:59 pm PT.

Status keys:

- ✅ verified
- 🟡 prepared, needs a user action
- 🔴 missing or at risk
- ❓ only the entrant can confirm

## Fields to fill in on the Projects page

| Field | Value | Status |
| --- | --- | --- |
| Project name | THE 12TH MAN | ✅ |
| Repository URL (must be public) | https://github.com/sasaisaschi/football (visibility PUBLIC, checked with `gh repo view`) | ✅ |
| Demo URL (free, no login) | GitHub Pages: `https://sasaisaschi.github.io/football/` once deployed (see below) | 🟡 not published yet |
| Video URL (YouTube, Vimeo, Facebook Video or Youku; public; under 2 min) | Script `DEMO_SCRIPT_EN.md`, video file to be rendered and uploaded | 🟡 |
| Pitch / description incl. Microsoft and Azure technologies | `PITCH_EN.md` | 🟡 Microsoft section depends on D2 (Foundry) |
| Testing instructions (English) | README "Quick start" and the section below | ✅ |
| Category | Grand Prize plus one category prize; see the recommendation below | ❓ |

## Compliance matrix

| # | Requirement (rules section) | Current evidence | What is missing | Action / owner |
| --- | --- | --- | --- | --- |
| 1 | Registered during the registration period (§4) | Confirmed by the entrant | – | ❓ entrant |
| 2 | New project after 29.09.2026 (§4.3) | Repository created 15.10.2026 (`gh repo view --json createdAt`); first commit 15.10.2026 | – | ✅ |
| 3 | Responds to the challenge: ingest → interpret → explain → render → personalize (§4.1) | `src/intel/` implements all five stages; tests in `src/intel/intel.test.ts`; fan and analyst modes, EN/DE, focus player, club choice | – | ✅ |
| 4 | Fits at least one category; "reasonably applies to the required technologies" (§4.2, §6.1 Stage One pass/fail) | Microsoft Foundry integration prepared (`api/`, `src/intel/foundry/`) but **not deployed** | A working Microsoft/Azure technology in the product | 🔴 **highest risk**: without a live Microsoft service the entry may fail Stage One. Entrant decides on a minimal Foundry deployment (see `api/README.md`). |
| 5 | Pitch: what was built, which Microsoft and Azure technologies, what it does, which problem (§4.4) | `PITCH_EN.md` | Final wording of the Microsoft section after #4 | 🟡 |
| 6 | Demo video under 2 min, shows the project working, public URL on an allowed platform, no third-party trademarks or copyrighted music (§4.4) | Script `DEMO_SCRIPT_EN.md`; footage from real browser runs; no music; fictional clubs | Rendering, upload, URL | 🟡 entrant uploads |
| 7 | Public GitHub repository (§4.4) | PUBLIC | – | ✅ |
| 8 | Not a winner of another contest (§4.4) | – | – | ❓ entrant |
| 9 | No offensive, political or promotional content (§4.4) | Fictional football only | – | ✅ |
| 10 | Testing access free and without restriction until judging ends (§4.8) | Static site; no login; GitHub Pages workflow prepared (manual only) | Enable Pages, run the workflow, keep it online until 10.11.2026 | 🟡 entrant |
| 11 | English materials (§4.9) | UI English by default (German switchable), README, pitch, script, test instructions | – | ✅ |
| 12 | Original work, IP and open-source licences (§4.6, §4.11) | Runtime dependencies: three.js (MIT), Rapier (Apache-2.0); build: Vite (MIT), TypeScript (Apache-2.0); no external images, fonts, sounds or models (figures and stadium are procedural, sound is synthesised) | The repository has no LICENSE file | ❓ entrant chooses a licence (e.g. MIT) or none; the rules grant the sponsor a licence anyway (§7) |
| 13 | Synthetic, football-realistic data; no unlicensed footage (§4.7) | All events come from the simulation; sample dataset in `sample-data/` (event log and intelligence feed of one 2 × 15 match) | – | ✅ |
| 14 | Third-party SDKs and APIs used in accordance with their terms (§4.3) | OSS licences above; Foundry would run under the entrant's Azure subscription terms | – | ✅ / ❓ once Azure is used |
| 15 | No financial or preferential support from Microsoft (§4.12) | – | – | ❓ entrant |
| 16 | No personal data of team members in the submission (§14) | Repository contains the git author name only | – | ✅ |
| 17 | Video and text describe what the project really does (§4.3 "Functionality") | The cloud narration is described as prepared, not as working | Keep it that way until it works | ✅ |

**Development tooling:** the code was written with an AI coding assistant (Claude Code). The rules do not forbid this. If the form asks about tools, disclose it.

## Category recommendation

- **Grand Prize:** the main target. The full five-stage pipeline, personalisation and explainability are in place.
- **Best Use of Microsoft Foundry:** only if the Foundry narration is deployed and visible in the demo and video.
- **Best Multi-Agent System:** not recommended. The player agents are simulation agents, and the intelligence pipeline is staged modules, not an LLM multi-agent system. Claiming it would not hold up against the judging description.

## Testing instructions (paste into the form)

1. Open the demo URL in a current desktop browser (Chrome, Edge or Firefox; WebGL 2 and WASM SIMD). No login is needed.
2. On the start screen:
   - Choose your club, **Fan** or **Analyst**, optionally a focus player, and **2 × 15 min**.
   - Press **Kick-off**.
   - A session takes about 7 minutes.
3. When the match stops at a decision:
   - Read *Why it matters*.
   - Press **1–4** (or click) to choose, or **0** to leave it to the players.
   - The consequence card shows what really happened.
4. Press **I** at any time to switch between fan and analyst mode. Analyst mode shows the statistics, the insight feed with the events each insight rests on, and the focus player's numbers.
5. At full time, read the match report and download the match-intelligence JSON.
6. Optional URL parameters:
   - `?lang=de` German
   - `?mode=analyst`
   - `?team=1` coach the away side
   - `?seed=7` reproducible match

## Verification log (Phase D)

See [PROJECT_REPORT.md §12](../PROJECT_REPORT.md) for every test and browser run with its result.

## Still to do by the entrant

1. Decide on the Microsoft technology (#4). The recommended minimum is the Foundry narration from `api/README.md`.
2. Enable GitHub Pages and run the workflow; check the public URL in a private window.
3. Render and upload the video, then enter its URL.
4. Choose the category.
5. Decide on a licence.
6. Submit before 28.10.2026, 07:59 CET.
