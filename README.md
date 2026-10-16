# THE 12TH MAN — CLEAN RESTART

This branch is a clean restart. No previous application code, dependencies, lockfiles, build configuration, archived files or legacy architecture are carried forward.

## Product mandate

Build a new 11-versus-11 football experience for the Microsoft × Premier League hackathon. The user does **not** play every action or passively watch a scripted match. A Match Director identifies rare consequential situations in which the user's choice could materially improve or worsen their team's outcome. The user chooses among actually executable options. Autonomous players, physically consistent ball/body/foot contacts and an independent referee determine what happens. No fabricated scenes, predetermined goals, ball teleportation, scripted results or predetermined success. The coherent match state persists between interventions; unimportant passages may be condensed without inventing outcomes. The experience should feel like a live football broadcast, not a physics debugger.

## Fresh implementation rules

Start from first principles. Select the newest mutually compatible **stable** runtime, packages, physics/rendering and testing stack at implementation time; justify choices, do not pin obsolete versions or reuse legacy scaffolding. Do not touch the user's system-wide Node/npm installation. Write a new architecture and tests before extending features. Use real 11v11 and IFAB geometry from the outset. Establish clear boundaries between authoritative simulation, match-direction, user choice, refereeing and presentation. Keep all generated files and configuration consistent. Verify installation, typecheck, tests, build and actual browser behavior before declaring success. Record exact versions, commands, measurements and limitations in a newly written PROJECT_REPORT.md.

The former implementation is available only in Git history on main; it is **not** an implementation template. Do not cherry-pick or copy old files. The user-approved product principles above, not the old technical design, govern the rebuild.
