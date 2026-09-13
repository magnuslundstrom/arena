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
export const PILLARS = [
  { x: 820, y: 350, radius: 105 },
  { x: 1180, y: 850, radius: 105 },
] as const;

export function hasLineOfSight(a: Point, b: Point): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  return PILLARS.every((p) => {
    const t = length
      ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0, 1)
      : 0;
    return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) > p.radius;
  });
}

function walkable(point: Point) {
  return PILLARS.every((p) => distance(point, p) >= p.radius + 35);
}

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
  | "immunity"
  | "damage-reduction"
  | "evasion"
  | "cloak"
  | "stun"
  | "fear"
  | "polymorph"
  | "root"
  | "silence"
  | "slow"
  | "stealth";
export interface PlayerState extends MatchPlayer {
  readonly periodicHealing?: {
    amount: number;
    nextTick: number;
    ticksLeft: number;
  };
  readonly comboPoints?: number;
  readonly comboTargetId?: string;
  readonly diminishingReturns?: Readonly<
    Partial<Record<Status, { count: number; resetsAt: number }>>
  >;
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
      readonly x: number;
      readonly y: number;
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
      statuses: player.specId === "subtlety-rogue" ? { stealth: 600 } : {},
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
  const moved = new Set<string>();
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
      if (command.kind === "move") {
        if (moved.has(command.playerId)) return false;
        moved.add(command.playerId);
      }
      applyCommand(players, command, tick, events);
      return true;
    });
  completeCasts(players, tick, events);
  for (const player of Object.values(players)) {
    const hot = player.periodicHealing;
    if (!hot || hot.nextTick > tick || hot.ticksLeft <= 0 || player.health <= 0)
      continue;
    const amount = Math.min(
      hot.amount,
      SPECS[player.specId].maxHealth - player.health,
    );
    players[player.id] = {
      ...player,
      health: player.health + amount,
      periodicHealing: {
        ...hot,
        nextTick: tick + 90,
        ticksLeft: hot.ticksLeft - 1,
      },
    };
    events.push({
      tick,
      type: "heal",
      targetId: player.id,
      amount,
      text: `Renew healed ${amount}`,
    });
  }
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

export function botCommands(
  state: MatchState,
  botIds: readonly string[],
): SimulationCommand[] {
  const commands: SimulationCommand[] = [];
  for (const id of botIds) {
    const player = state.players[id];
    if (!player || player.health <= 0) continue;
    const enemies = Object.values(state.players).filter(
      (p) => p.team !== player.team && p.health > 0,
    );
    const enemy = enemies.sort(
      (a, b) => distance(player, a) - distance(player, b),
    )[0];
    if (!enemy) continue;
    const ally = Object.values(state.players)
      .filter((p) => p.team === player.team && p.health > 0)
      .sort(
        (a, b) =>
          a.health / SPECS[a.specId].maxHealth -
          b.health / SPECS[b.specId].maxHealth,
      )[0];
    const healing =
      player.specId === "discipline-priest" &&
      ally &&
      ally.health < SPECS[ally.specId].maxHealth * 0.75;
    const target = healing ? ally : enemy;
    const ability = getAbility(
      player.specId,
      healing
        ? "flash-heal"
        : player.specId === "frost-mage"
          ? "frostbolt"
          : player.specId === "subtlety-rogue"
            ? "hemorrhage"
            : "shadow-word-death",
    );
    const base = { playerId: id, targetTick: state.tick + 1 };
    if (
      ability &&
      distance(player, target) <= ability.range &&
      hasLineOfSight(player, target)
    ) {
      commands.push({
        ...base,
        sequence: player.lastSequence + 1,
        kind: "ability",
        abilityId: ability.id,
        targetId: target.id,
      });
    } else {
      let dx = target.x - player.x,
        dy = target.y - player.y;
      const blocking = PILLARS.find(
        (p) => distance(player, p) < p.radius + 140,
      );
      if (blocking) {
        dx = target.x - player.x;
        dy = player.y <= blocking.y ? -200 : 200;
      }
      commands.push({
        ...base,
        sequence: player.lastSequence + 1,
        kind: "move",
        x: Math.sign(dx) as -1 | 0 | 1,
        y: Math.abs(dy) < 15 ? 0 : (Math.sign(dy) as -1 | 0 | 1),
      });
    }
  }
  return commands;
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
  if ((player.statuses.immunity ?? 0) > tick) return;
  if (command.kind === "target") {
    if ((players[command.targetId]?.health ?? 0) > 0)
      players[player.id] = { ...player, targetId: command.targetId };
    return;
  }
  if (command.kind === "move") {
    if (controlled(player, tick) || (player.statuses.root ?? 0) > tick) return;
    const speed =
      SPECS[player.specId].speed *
      ((player.statuses.slow ?? 0) > tick ? 0.5 : 1);
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return;
    const scale = 1 / Math.max(1, Math.hypot(command.x, command.y));
    const destination = {
      x: Math.round(
        clamp(player.x + command.x * speed * scale, 35, ARENA_WIDTH - 35),
      ),
      y: Math.round(
        clamp(player.y + command.y * speed * scale, 35, ARENA_HEIGHT - 35),
      ),
    };
    if (!walkable(destination)) return;
    players[player.id] = {
      ...player,
      ...destination,
      cast: undefined,
    };
    return;
  }
  if (
    (controlled(player, tick) &&
      !["ice-block", "blink"].includes(command.abilityId)) ||
    (player.statuses.silence ?? 0) > tick ||
    player.cast
  )
    return;
  const ability = getAbility(player.specId, command.abilityId);
  if (!ability) return;
  const target = resolveTarget(players, player, ability, command.targetId);
  if (
    ability.id === "stealth" &&
    Object.values(players).some(
      (p) =>
        p.team !== player.team && p.health > 0 && distance(p, player) < 500,
    )
  )
    return;
  if (
    player.globalCooldownUntil > tick ||
    (player.cooldowns[ability.id] ?? 0) > tick ||
    player.mana < ability.manaCost ||
    !validTarget(player, target, ability) ||
    (target &&
      target.team !== player.team &&
      (target.statuses.stealth ?? 0) > tick &&
      distance(player, target) > 160) ||
    (ability.id === "cheap-shot" && (player.statuses.stealth ?? 0) <= tick) ||
    (["kidney-shot", "eviscerate"].includes(ability.id) &&
      (!player.comboPoints || player.comboTargetId !== target?.id)) ||
    (target && !hasLineOfSight(player, target)) ||
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
    statuses: {
      ...player.statuses,
      ...(ability.target === "enemy" ? { stealth: 0 } : {}),
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
    const target = players[player.cast.targetId ?? player.id];
    if (
      ability &&
      player.health > 0 &&
      !controlled(player, tick) &&
      validTarget(player, target, ability) &&
      target &&
      distance(player, target) <= ability.range &&
      hasLineOfSight(player, target)
    )
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
      const length = distance(source, destination);
      const ratio = Math.min(1, ability.range / Math.max(1, length));
      const landing = {
        x: Math.round(
          clamp(
            source.x + (destination.x - source.x) * ratio,
            35,
            ARENA_WIDTH - 35,
          ),
        ),
        y: Math.round(
          clamp(
            source.y + (destination.y - source.y) * ratio,
            35,
            ARENA_HEIGHT - 35,
          ),
        ),
      };
      if (!walkable(landing)) continue;
      players[sourceId] = {
        ...source,
        ...landing,
        statuses: { ...source.statuses, root: 0, stun: 0 },
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
        shield: Math.max(target.shield, effect.amount ?? 0),
      };
    else if (effect.kind === "heal" && target) {
      if (ability.id === "renew") {
        players[target.id] = {
          ...target,
          periodicHealing: { amount: 110, nextTick: tick + 90, ticksLeft: 5 },
        };
        continue;
      }
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
      if (
        (target.statuses.immunity ?? 0) > tick ||
        ((target.statuses.cloak ?? 0) > tick &&
          source.specId !== "subtlety-rogue")
      )
        continue;
      const amount =
        ability.id === "eviscerate"
          ? 90 + (source.comboPoints ?? 0) * 70
          : ability.id === "ice-lance" && (target.statuses.root ?? 0) > tick
            ? (effect.amount ?? 0) * 3
            : (effect.amount ?? 0);
      const mitigated = Math.round(
        amount *
          ((target.statuses[
            source.specId === "subtlety-rogue" ? "evasion" : "immunity"
          ] ?? 0) > tick
            ? 0.5
            : 1) *
          ((target.statuses["damage-reduction"] ?? 0) > tick ? 0.6 : 1),
      );
      const absorbed = Math.min(target.shield, mitigated);
      const dealt = mitigated - absorbed;
      const health = Math.max(0, target.health - dealt);
      players[target.id] = {
        ...target,
        health,
        mana:
          ability.id === "mana-burn"
            ? Math.max(0, target.mana - 300)
            : target.mana,
        shield: target.shield - absorbed,
        statuses: {
          ...target.statuses,
          polymorph: undefined,
          stealth: undefined,
        },
      };
      if (ability.id === "hemorrhage" || ability.id === "cheap-shot")
        players[sourceId] = {
          ...players[sourceId]!,
          comboTargetId: target.id,
          comboPoints: Math.min(
            5,
            (source.comboTargetId === target.id
              ? (source.comboPoints ?? 0)
              : 0) + 1,
          ),
        };
      if (ability.id === "eviscerate")
        players[sourceId] = { ...players[sourceId]!, comboPoints: 0 };
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
        "immunity",
        "damage-reduction",
        "evasion",
        "cloak",
      ].includes(effect.kind)
    ) {
      const status = effect.kind as Status;
      const isControl = ["stun", "fear", "polymorph", "root"].includes(status);
      const prior = target.diminishingReturns?.[status];
      const count = prior && prior.resetsAt > tick ? prior.count : 0;
      if (isControl && count >= 3) continue;
      const duration =
        ability.id === "kidney-shot"
          ? ((source.comboPoints ?? 1) + 1) * 30
          : (effect.durationTicks ?? 0);
      const until = tick + Math.floor(duration / (isControl ? 2 ** count : 1));
      players[target.id] = {
        ...target,
        ...(["silence", "stun", "fear", "polymorph"].includes(status)
          ? { cast: undefined }
          : {}),
        ...(isControl
          ? {
              diminishingReturns: {
                ...target.diminishingReturns,
                [status]: { count: count + 1, resetsAt: until + 450 },
              },
            }
          : {}),
        statuses: {
          ...target.statuses,
          [status]: until,
        },
      };
      if (ability.id === "kidney-shot")
        players[sourceId] = { ...players[sourceId]!, comboPoints: 0 };
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
