# Arena Browser

A browser-based, real-time 2v2 arena combat game with an authoritative server and an original presentation.

## Requirements

- Node.js 22 or newer
- pnpm 9.5.0

## Local development

```sh
pnpm install
pnpm dev
```

The client runs at `http://localhost:5173`. The game server runs at `http://localhost:3001`; its health endpoint is `GET /health` and its WebSocket endpoint is `/connect`.

Choose **Practice with bots** to play immediately with an allied healer and two opponents. Each practice match is private. **Join match** starts a shared 2v2 match once four players have joined. Controls:

- `WASD`: move
- Movement follows the third-person camera. Hold the right mouse button and drag to orbit; scroll to zoom.
- Click a combatant: select a target
- `Tab`: cycle enemy targets; unit frames also select targets
- `1`–`0`: use the corresponding ability
- `Q`: Ice Block (Mage) or Stealth (Rogue)

The arena uses Three.js with a following perspective camera, original geometric character models, animated legs, shadowed 3D pillars, and camera obstruction checks. Character positions and combat remain authoritative on the server; presentation smooths updates between snapshots.

The current playable roster is Frost Mage, Subtlety Rogue, and Discipline Priest, with ten or eleven abilities per spec. This is an original prototype inspired by the combat structure of classic tab-target arena games; visual presentation and implementation are original.

Pillars block movement and line of sight. Cast completion revalidates range and sight. Control has diminishing returns; Rogue finishers require combo points; Renew heals periodically. Practice bots follow the same simulation commands as players. Tuning and several ability effects remain simplified, and public matches currently reset on disconnect. Accounts, ranked matchmaking, reconnect recovery, and full TBC ability fidelity are still outstanding.

## Verification

```sh
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

## Architecture invariants

- The client sends intent; the game server owns truth.
- Simulation advances at a fixed 30 Hz and uses integer ticks rather than wall-clock time.
- `packages/simulation` is pure: no networking, persistence, timers, filesystem, or environment reads.
- Protocol messages are explicit, runtime-validated, and independently versioned.
- Simulation inputs have stable ordering, and randomness must come from match-owned seeded state.
- Live match state stays out of the database hot path; persistence records durable match facts and results.
- Original names, art, audio, text, maps, and other presentation assets are required.

## Workspace

- `apps/client`: SolidJS/Vite browser shell
- `apps/game-server`: Fastify HTTP and WebSocket bootstrap
- `packages/protocol`: shared wire schemas and types
- `packages/simulation`: deterministic fixed-step simulation seam
- `packages/game-content`: specs, ability definitions, and balance values
- `packages/config`: strict shared TypeScript configuration
