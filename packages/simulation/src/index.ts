import {
  getAbility,
  SPECS,
  type AbilityDefinition,
  type SpecId,
} from "@arena/game-content";

export const TICKS_PER_SECOND = 30 as const;
export const TICK_DURATION_MS = 1_000 / TICKS_PER_SECOND;
export const ARENA_WIDTH = 2_000;
export const ARENA_HEIGHT = 1_200;

export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface MatchPlayer {
  readonly id: string;
  readonly name: string;
  readonly team: 0 | 1;
  readonly specId: SpecId;
}
export interface CastState {
  readonly abilityId: string;
  readonly targetId?: string;
  readonly point?: Point;
  readonly completesAtTick: number;
}
export type Status =
  "stun" | "fear" | "polymorph" | "root" | "silence" | "slow" | "stealth";
export interface PlayerState extends MatchPlayer {
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly mana: number;
  readonly shield: number;
  readonly targetId?: string;
  readonly cast?: CastState | undefined;
  readonly globalCooldownUntil: number;
  readonly cooldowns: Readonly<Record<string, number>>;
  readonly statuses: Readonly<Partial<Record<Status, number | undefined>>>;
  readonly lastSequence: number;
}
export interface CombatEvent {
  readonly tick: number;
  readonly type: "ability" | "damage" | "heal" | "control" | "death" | "system";
  readonly sourceId?: string;
  readonly targetId?: string;
  readonly abilityId?: string;
  readonly amount?: number;
  readonly text: string;
}
export interface MatchState {
  readonly tick: number;
  readonly seed: number;
  readonly phase: "waiting" | "running" | "finished";
  readonly winnerTeam?: 0 | 1;
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly events: readonly CombatEvent[];
}
interface CommandBase {
  readonly playerId: string;
  readonly sequence: number;
  readonly targetTick: number;
}
export type SimulationCommand =
  | (CommandBase & {
      readonly kind: "move";
      readonly x: -1 | 0 | 1;
      readonly y: -1 | 0 | 1;
    })
  | (CommandBase & { readonly kind: "target"; readonly targetId: string })
  | (CommandBase & {
      readonly kind: "ability";
      readonly abilityId: string;
      readonly targetId?: string;
      readonly point?: Point;
    });
export interface TickResult {
  readonly state: MatchState;
  readonly appliedCommands: readonly SimulationCommand[];
}

export function createMatch(
  roster: readonly MatchPlayer[],
  seed: number,
): MatchState {
  if (!Number.isSafeInteger(seed))
    throw new TypeError("Simulation seed must be a safe integer");
  const players: Record<string, PlayerState> = {};
  const teamSlots: [number, number] = [0, 0];
  for (const player of roster) {
    const slot = teamSlots[player.team]++;
    const spec = SPECS[player.specId];
    players[player.id] = {
      ...player,
      x: player.team === 0 ? 250 : ARENA_WIDTH - 250,
      y: 450 + slot * 300,
      health: spec.maxHealth,
      mana: spec.maxMana,
      shield: 0,
      globalCooldownUntil: 0,
      cooldowns: {},
      statuses: {},
      lastSequence: -1,
    };
  }
  return {
    tick: 0,
    seed,
    phase: roster.length === 4 ? "running" : "waiting",
    players,
    events: [],
  };
}

export function advanceTick(
  state: MatchState,
  commands: readonly SimulationCommand[],
): TickResult {
  if (state.phase === "finished") return { state, appliedCommands: [] };
  const tick = state.tick + 1;
  const players = clonePlayers(state.players);
  const events: CombatEvent[] = [];
  completeCasts(players, tick, events);
  const appliedCommands = commands
    .filter((c) => c.targetTick <= tick)
    .sort(compareCommands)
    .filter((command) => {
      const player = players[command.playerId];
      if (
        !player ||
        command.sequence <= player.lastSequence ||
        player.health <= 0
      )
        return false;
      players[command.playerId] = { ...player, lastSequence: command.sequence };
      applyCommand(players, command, tick, events);
      return true;
    });
  regenerate(players);
  const alive = [0, 1].map((team) =>
    Object.values(players).some(
      (player) => player.team === team && player.health > 0,
    ),
  );
  const winnerTeam = !alive[0] ? 1 : !alive[1] ? 0 : undefined;
  return {
    state: {
      tick,
      seed: state.seed,
      phase: winnerTeam === undefined ? state.phase : "finished",
      ...(winnerTeam === undefined ? {} : { winnerTeam }),
      players,
      events,
    },
    appliedCommands,
  };
}

function clonePlayers(
  source: MatchState["players"],
): Record<string, PlayerState> {
  return Object.fromEntries(
    Object.entries(source).map(([id, p]) => [
      id,
      { ...p, cooldowns: { ...p.cooldowns }, statuses: { ...p.statuses } },
    ]),
  );
}
function compareCommands(a: SimulationCommand, b: SimulationCommand) {
  return (
    a.playerId.localeCompare(b.playerId, "en") ||
    a.sequence - b.sequence ||
    a.kind.localeCompare(b.kind, "en")
  );
}
function controlled(player: PlayerState, tick: number) {
  return (["stun", "fear", "polymorph"] as const).some(
    (status) => (player.statuses[status] ?? 0) > tick,
  );
}

function applyCommand(
  players: Record<string, PlayerState>,
  command: SimulationCommand,
  tick: number,
  events: CombatEvent[],
) {
  const player = players[command.playerId];
  if (!player) return;
  if (command.kind === "target") {
    if ((players[command.targetId]?.health ?? 0) > 0)
      players[player.id] = { ...player, targetId: command.targetId };
    return;
  }
  if (command.kind === "move") {
    if (
      controlled(player, tick) ||
      (player.statuses.root ?? 0) > tick ||
      player.cast
    )
      return;
    const speed =
      SPECS[player.specId].speed *
      ((player.statuses.slow ?? 0) > tick ? 0.5 : 1);
    players[player.id] = {
      ...player,
      x: clamp(player.x + command.x * speed, 35, ARENA_WIDTH - 35),
      y: clamp(player.y + command.y * speed, 35, ARENA_HEIGHT - 35),
    };
    return;
  }
  if (
    controlled(player, tick) ||
    (player.statuses.silence ?? 0) > tick ||
    player.cast
  )
    return;
  const ability = getAbility(player.specId, command.abilityId);
  if (!ability) return;
  const target = resolveTarget(players, player, ability, command.targetId);
  if (
    player.globalCooldownUntil > tick ||
    (player.cooldowns[ability.id] ?? 0) > tick ||
    player.mana < ability.manaCost ||
    !validTarget(player, target, ability) ||
    (target && ability.range > 0 && distance(player, target) > ability.range)
  )
    return;
  const paid = {
    ...player,
    mana: player.mana - ability.manaCost,
    globalCooldownUntil: tick + 30,
    cooldowns: {
      ...player.cooldowns,
      [ability.id]: tick + ability.cooldownTicks,
    },
  };
  if (ability.castTicks > 0)
    players[player.id] = {
      ...paid,
      cast: {
        abilityId: ability.id,
        ...(target ? { targetId: target.id } : {}),
        ...(command.point ? { point: command.point } : {}),
        completesAtTick: tick + ability.castTicks,
      },
    };
  else {
    players[player.id] = paid;
    resolveAbility(
      players,
      player.id,
      ability,
      target?.id,
      command.point,
      tick,
      events,
    );
  }
}

function resolveTarget(
  players: Record<string, PlayerState>,
  player: PlayerState,
  ability: AbilityDefinition,
  targetId?: string,
) {
  return ability.target === "self"
    ? players[player.id]
    : players[targetId ?? player.targetId ?? ""];
}
function validTarget(
  player: PlayerState,
  target: PlayerState | undefined,
  ability: AbilityDefinition,
) {
  if (ability.target === "point" || ability.target === "self") return true;
  return (
    !!target &&
    target.health > 0 &&
    (ability.target === "ally"
      ? target.team === player.team
      : target.team !== player.team)
  );
}
function completeCasts(
  players: Record<string, PlayerState>,
  tick: number,
  events: CombatEvent[],
) {
  for (const player of Object.values(players)) {
    if (!player.cast || player.cast.completesAtTick > tick) continue;
    const ability = getAbility(player.specId, player.cast.abilityId);
    players[player.id] = { ...player, cast: undefined };
    if (ability)
      resolveAbility(
        players,
        player.id,
        ability,
        player.cast.targetId,
        player.cast.point,
        tick,
        events,
      );
  }
}

function resolveAbility(
  players: Record<string, PlayerState>,
  sourceId: string,
  ability: AbilityDefinition,
  targetId: string | undefined,
  point: Point | undefined,
  tick: number,
  events: CombatEvent[],
) {
  let source = players[sourceId];
  if (!source) return;
  let target = players[targetId ?? sourceId];
  events.push({
    tick,
    type: "ability",
    sourceId,
    ...(target ? { targetId: target.id } : {}),
    abilityId: ability.id,
    text: `${source.name} used ${ability.name}`,
  });
  for (const effect of ability.effects) {
    source = players[sourceId];
    target = players[targetId ?? sourceId];
    if (!source) return;
    if (effect.kind === "teleport") {
      const destination =
        point ??
        (target
          ? { x: target.x + (target.team === 0 ? 100 : -100), y: target.y }
          : source);
      players[sourceId] = {
        ...source,
        x: clamp(destination.x, 35, ARENA_WIDTH - 35),
        y: clamp(destination.y, 35, ARENA_HEIGHT - 35),
      };
    } else if (effect.kind === "reset-cooldowns")
      players[sourceId] = {
        ...source,
        cooldowns: { [ability.id]: source.cooldowns[ability.id] ?? tick },
      };
    else if (effect.kind === "dispel" && target)
      players[target.id] = { ...target, statuses: {} };
    else if (effect.kind === "shield" && target)
      players[target.id] = {
        ...target,
        shield: target.shield + (effect.amount ?? 0),
      };
    else if (effect.kind === "heal" && target) {
      const amount = Math.min(
        effect.amount ?? 0,
        SPECS[target.specId].maxHealth - target.health,
      );
      players[target.id] = { ...target, health: target.health + amount };
      events.push({
        tick,
        type: "heal",
        sourceId,
        targetId: target.id,
        amount,
        abilityId: ability.id,
        text: `${ability.name} healed ${amount}`,
      });
    } else if (effect.kind === "damage" && target) {
      const amount = effect.amount ?? 0;
      const absorbed = Math.min(target.shield, amount);
      const dealt = amount - absorbed;
      const health = Math.max(0, target.health - dealt);
      players[target.id] = {
        ...target,
        health,
        shield: target.shield - absorbed,
        statuses: {
          ...target.statuses,
          polymorph: undefined,
          stealth: undefined,
        },
      };
      events.push({
        tick,
        type: "damage",
        sourceId,
        targetId: target.id,
        amount: dealt,
        abilityId: ability.id,
        text: `${ability.name} dealt ${dealt}`,
      });
      if (health === 0)
        events.push({
          tick,
          type: "death",
          sourceId,
          targetId: target.id,
          text: `${target.name} was defeated`,
        });
    } else if (
      target &&
      [
        "stun",
        "fear",
        "polymorph",
        "root",
        "silence",
        "slow",
        "stealth",
      ].includes(effect.kind)
    ) {
      const status = effect.kind as Status;
      players[target.id] = {
        ...target,
        ...(status === "silence" ? { cast: undefined } : {}),
        statuses: {
          ...target.statuses,
          [status]: tick + (effect.durationTicks ?? 0),
        },
      };
      events.push({
        tick,
        type: "control",
        sourceId,
        targetId: target.id,
        abilityId: ability.id,
        text: `${target.name}: ${status}`,
      });
    }
  }
}
function regenerate(players: Record<string, PlayerState>) {
  for (const player of Object.values(players)) {
    const max = SPECS[player.specId].maxMana;
    players[player.id] = {
      ...player,
      mana: Math.min(
        max,
        player.mana + (player.specId === "subtlety-rogue" ? 2 : 1),
      ),
    };
  }
}
function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
