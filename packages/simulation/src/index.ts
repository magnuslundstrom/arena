import {
  getAbility,
  SPECS,
  type AbilityDefinition,
  type SpecId,
} from "@arena/game-content";

export const TICKS_PER_SECOND = 30 as const;
export const TICK_DURATION_MS = 1_000 / TICKS_PER_SECOND;
export const ROGUE_ENERGY_PER_TICK = 20 as const;
export const ROGUE_ENERGY_TICK_INTERVAL = TICKS_PER_SECOND * 2;
export const COMBAT_DURATION_TICKS = TICKS_PER_SECOND * 8;
export const ROGUE_MAIN_HAND_SWING_TICKS = Math.round(TICKS_PER_SECOND * 2.6);
export const ROGUE_OFF_HAND_SWING_TICKS = Math.round(TICKS_PER_SECOND * 1.4);
export const ARENA_WIDTH = 2_000;
export const ARENA_HEIGHT = 1_200;
export const PILLARS = [
  { x: 820, y: 350, radius: 105 },
  { x: 1180, y: 850, radius: 105 },
] as const;

export function canObservePlayer(
  viewer: PlayerState,
  candidate: PlayerState,
  tick: number,
  stealthDetectionRange: number,
) {
  return (
    candidate.team === viewer.team ||
    (candidate.statuses.stealth ?? 0) <= tick ||
    distance(viewer, candidate) <= stealthDetectionRange
  );
}

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
  readonly pushbackCount?: number;
}
export type Status =
  | "immunity"
  | "damage-reduction"
  | "evasion"
  | "cloak"
  | "stun"
  | "fear"
  | "polymorph"
  | "incapacitate"
  | "root"
  | "silence"
  | "slow"
  | "stealth";
type DiminishingCategory = Status | "kidney-shot";
export interface PlayerState extends MatchPlayer {
  readonly autoAttackTargetId?: string | undefined;
  readonly nextMainHandSwingTick?: number | undefined;
  readonly nextOffHandSwingTick?: number | undefined;
  readonly combatUntilTick?: number;
  readonly jumpStartedTick?: number;
  readonly jumpUntilTick?: number;
  readonly periodicHealing?: {
    amount: number;
    nextTick: number;
    ticksLeft: number;
    sourceId: string;
  };
  readonly comboPoints?: number;
  readonly comboTargetId?: string;
  readonly rootFrostHits?: number | undefined;
  readonly fearSourceId?: string;
  readonly polymorphNextHealTick?: number;
  readonly diminishingReturns?: Readonly<
    Partial<Record<DiminishingCategory, { count: number; resetsAt: number }>>
  >;
  readonly x: number;
  readonly y: number;
  readonly facingX: number;
  readonly facingY: number;
  readonly health: number;
  readonly mana: number;
  readonly shield: number;
  readonly shieldAbility?:
    | {
        readonly abilityId: string;
        readonly specId: SpecId;
      }
    | undefined;
  readonly targetId?: string;
  readonly cast?: CastState | undefined;
  readonly globalCooldownUntil: number;
  readonly cooldowns: Readonly<Record<string, number>>;
  readonly statuses: Readonly<Partial<Record<Status, number | undefined>>>;
  readonly statusAbilities?: Readonly<
    Partial<
      Record<Status, { readonly abilityId: string; readonly specId: SpecId }>
    >
  >;
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
  readonly map?: "arena" | "playground";
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly stats: Readonly<Record<string, PlayerMatchStats>>;
  readonly events: readonly CombatEvent[];
}
export interface PlayerMatchStats {
  readonly damageDone: number;
  readonly healingDone: number;
  readonly killingBlows: number;
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
  | (CommandBase & { readonly kind: "jump" })
  | (CommandBase & {
      readonly kind: "cancel-aura";
      readonly abilityId: "ice-block";
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
      facingX: player.team === 0 ? 1 : -1,
      facingY: 0,
      health: spec.maxHealth,
      mana: spec.maxMana,
      shield: 0,
      globalCooldownUntil: 0,
      cooldowns: {},
      statuses:
        player.specId === "subtlety-rogue"
          ? { stealth: TICKS_PER_SECOND * 600 }
          : {},
      lastSequence: -1,
    };
  }
  return {
    tick: 0,
    seed,
    phase: roster.length === 4 ? "running" : "waiting",
    players,
    stats: Object.fromEntries(
      roster.map((player) => [
        player.id,
        { damageDone: 0, healingDone: 0, killingBlows: 0 },
      ]),
    ),
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
  const applicableCommands = commands
    .filter((c) => c.targetTick <= tick)
    .sort(compareCommands);
  const commandsByPlayer = new Map<string, SimulationCommand[]>();
  for (const command of applicableCommands) {
    const playerCommands = commandsByPlayer.get(command.playerId) ?? [];
    playerCommands.push(command);
    commandsByPlayer.set(command.playerId, playerCommands);
  }
  const appliedCommands: SimulationCommand[] = [];
  for (const [playerId, playerCommands] of commandsByPlayer) {
    const player = players[playerId];
    if (!player || player.health <= 0) continue;
    let lastSequence = player.lastSequence;
    let acceptedMove = false;
    const accepted = playerCommands.filter((command) => {
      if (command.sequence <= lastSequence) return false;
      lastSequence = command.sequence;
      if (command.kind !== "move") return true;
      if (acceptedMove) return false;
      acceptedMove = true;
      return true;
    });
    players[playerId] = { ...player, lastSequence };
    accepted.sort((a, b) =>
      a.kind === "move" && b.kind !== "move"
        ? 1
        : a.kind !== "move" && b.kind === "move"
          ? -1
          : a.sequence - b.sequence,
    );
    for (const command of accepted) {
      applyCommand(players, command, tick, events);
      appliedCommands.push(command);
    }
  }
  completeCasts(players, tick, events);
  performAutoAttacks(players, tick, events);
  moveFearedPlayers(players, tick, state.seed);
  regeneratePolymorphedPlayers(players, tick, events);
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
      sourceId: hot.sourceId,
      targetId: player.id,
      amount,
      text: `Renew healed ${amount}`,
    });
  }
  regenerate(players, tick);
  const alive = [0, 1].map((team) =>
    Object.values(players).some(
      (player) => player.team === team && player.health > 0,
    ),
  );
  const winnerTeam = !alive[0] ? 1 : !alive[1] ? 0 : undefined;
  const stats = { ...state.stats };
  for (const event of events) {
    if (!event.sourceId || !stats[event.sourceId]) continue;
    const previous = stats[event.sourceId]!;
    stats[event.sourceId] = {
      damageDone:
        previous.damageDone +
        (event.type === "damage" ? (event.amount ?? 0) : 0),
      healingDone:
        previous.healingDone +
        (event.type === "heal" ? (event.amount ?? 0) : 0),
      killingBlows: previous.killingBlows + (event.type === "death" ? 1 : 0),
    };
  }
  return {
    state: {
      tick,
      seed: state.seed,
      phase: winnerTeam === undefined ? state.phase : "finished",
      ...(winnerTeam === undefined ? {} : { winnerTeam }),
      players,
      stats,
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
      (p) =>
        p.team !== player.team &&
        p.health > 0 &&
        canObservePlayer(player, p, state.tick, 0),
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
  return (["stun", "fear", "polymorph", "incapacitate"] as const).some(
    (status) => (player.statuses[status] ?? 0) > tick,
  );
}

function regeneratePolymorphedPlayers(
  players: Record<string, PlayerState>,
  tick: number,
  events: CombatEvent[],
) {
  for (const player of Object.values(players)) {
    if (
      player.health <= 0 ||
      (player.statuses.polymorph ?? 0) <= tick ||
      (player.polymorphNextHealTick ?? Infinity) > tick
    )
      continue;
    const amount = Math.min(
      Math.round(SPECS[player.specId].maxHealth * 0.1),
      SPECS[player.specId].maxHealth - player.health,
    );
    players[player.id] = {
      ...player,
      health: player.health + amount,
      polymorphNextHealTick: tick + TICKS_PER_SECOND,
    };
    if (amount > 0)
      events.push({
        tick,
        type: "heal",
        targetId: player.id,
        abilityId: "polymorph",
        amount,
        text: `Polymorph regenerated ${amount}`,
      });
  }
}

function moveFearedPlayers(
  players: Record<string, PlayerState>,
  tick: number,
  seed: number,
) {
  for (const player of Object.values(players)) {
    if (
      player.health <= 0 ||
      (player.statuses.fear ?? 0) <= tick ||
      (player.statuses.stun ?? 0) > tick ||
      (player.statuses.polymorph ?? 0) > tick
    )
      continue;
    const source = players[player.fearSourceId ?? ""];
    const fallbackAngle =
      ((seed + tick * 17 + hashString(player.id)) % 628) / 100;
    const awayAngle = source
      ? Math.atan2(player.y - source.y, player.x - source.x)
      : fallbackAngle;
    const angle =
      awayAngle + Math.sin((tick + hashString(player.id)) / 18) * 0.7;
    const speed = SPECS[player.specId].speed * 1.08;
    const attempts = [0, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2];
    for (const turn of attempts) {
      const destination = {
        x: Math.round(
          clamp(
            player.x + Math.cos(angle + turn) * speed,
            35,
            ARENA_WIDTH - 35,
          ),
        ),
        y: Math.round(
          clamp(
            player.y + Math.sin(angle + turn) * speed,
            35,
            ARENA_HEIGHT - 35,
          ),
        ),
      };
      if (!walkable(destination)) continue;
      players[player.id] = { ...player, ...destination, cast: undefined };
      break;
    }
  }
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++)
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function applyCommand(
  players: Record<string, PlayerState>,
  command: SimulationCommand,
  tick: number,
  events: CombatEvent[],
) {
  const player = players[command.playerId];
  if (!player) return;
  if (command.kind === "cancel-aura") {
    if (
      command.abilityId === "ice-block" &&
      (player.statuses.immunity ?? 0) > tick
    ) {
      players[player.id] = {
        ...player,
        statuses: { ...player.statuses, immunity: 0 },
      };
      events.push({
        tick,
        type: "system",
        sourceId: player.id,
        abilityId: "ice-block",
        text: `${player.name} canceled Ice Block`,
      });
    }
    return;
  }
  if (command.kind === "target") {
    if ((players[command.targetId]?.health ?? 0) > 0)
      players[player.id] = { ...player, targetId: command.targetId };
    return;
  }
  if ((player.statuses.immunity ?? 0) > tick) return;
  if (command.kind === "jump") {
    if (controlled(player, tick) || (player.jumpUntilTick ?? 0) > tick) return;
    players[player.id] = {
      ...player,
      cast: undefined,
      jumpStartedTick: tick,
      jumpUntilTick: tick + 24,
    };
    return;
  }
  if (command.kind === "move") {
    if (controlled(player, tick) || (player.statuses.root ?? 0) > tick) return;
    const speed =
      SPECS[player.specId].speed *
      ((player.statuses.slow ?? 0) > tick ? 0.5 : 1) *
      ((player.statuses.stealth ?? 0) > tick ? 0.7 : 1);
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
      ...(command.x !== 0 || command.y !== 0
        ? { facingX: command.x * scale, facingY: command.y * scale }
        : {}),
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
    (ability.id === "stealth" && (player.combatUntilTick ?? 0) > tick) ||
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
      ...(ability.target === "enemy" && ability.id !== "shadowstep"
        ? { stealth: 0 }
        : {}),
    },
    ...(target && target.id !== player.id
      ? {
          facingX:
            (target.x - player.x) /
            Math.max(1, Math.hypot(target.x - player.x, target.y - player.y)),
          facingY:
            (target.y - player.y) /
            Math.max(1, Math.hypot(target.x - player.x, target.y - player.y)),
        }
      : {}),
    ...(ability.id === "gouge"
      ? {
          autoAttackTargetId: undefined,
          nextMainHandSwingTick: undefined,
          nextOffHandSwingTick: undefined,
        }
      : player.specId === "subtlety-rogue" &&
          ability.target === "enemy" &&
          ability.id !== "shadowstep" &&
          target
        ? {
            autoAttackTargetId: target.id,
            nextMainHandSwingTick:
              player.nextMainHandSwingTick ??
              tick + ROGUE_MAIN_HAND_SWING_TICKS,
            nextOffHandSwingTick:
              player.nextOffHandSwingTick ?? tick + ROGUE_OFF_HAND_SWING_TICKS,
          }
        : {}),
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
    : ability.target === "enemy-area" || ability.target === "enemy-cone"
      ? players[player.id]
      : players[targetId ?? player.targetId ?? ""];
}
function validTarget(
  player: PlayerState,
  target: PlayerState | undefined,
  ability: AbilityDefinition,
) {
  if (
    ability.target === "point" ||
    ability.target === "self" ||
    ability.target === "enemy-area" ||
    ability.target === "enemy-cone"
  )
    return true;
  return (
    !!target &&
    target.health > 0 &&
    (ability.target === "any"
      ? true
      : ability.target === "ally"
        ? target.team === player.team
        : target.team !== player.team)
  );
}

const HARMFUL_DISPEL_ORDER: readonly Status[] = [
  "polymorph",
  "fear",
  "stun",
  "incapacitate",
  "silence",
  "root",
  "slow",
];
const BENEFICIAL_DISPEL_ORDER: readonly Status[] = [
  "immunity",
  "damage-reduction",
  "cloak",
  "evasion",
  "stealth",
];

function dispelOne(
  target: PlayerState,
  friendly: boolean,
  tick: number,
): PlayerState {
  if (friendly) {
    const status = HARMFUL_DISPEL_ORDER.find(
      (entry) => (target.statuses[entry] ?? 0) > tick,
    );
    if (!status) return target;
    const dispelled: PlayerState = {
      ...target,
      statuses: { ...target.statuses, [status]: undefined },
      ...(status === "root" ? { rootFrostHits: undefined } : {}),
    };
    if (status === "fear") {
      const { fearSourceId: _removed, ...withoutFearSource } = dispelled;
      return withoutFearSource;
    }
    if (status === "polymorph") {
      const { polymorphNextHealTick: _removed, ...withoutPolymorphHeal } =
        dispelled;
      return withoutPolymorphHeal;
    }
    return dispelled;
  }
  if (target.periodicHealing) {
    const { periodicHealing: _removed, ...withoutPeriodicHealing } = target;
    return withoutPeriodicHealing;
  }
  if (target.shield > 0) return { ...target, shield: 0 };
  const status = BENEFICIAL_DISPEL_ORDER.find(
    (entry) => (target.statuses[entry] ?? 0) > tick,
  );
  return status
    ? { ...target, statuses: { ...target.statuses, [status]: undefined } }
    : target;
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
      (target.team === player.team || (target.statuses.stealth ?? 0) <= tick) &&
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
    if (ability.target === "enemy-area") {
      if (!["stun", "fear", "polymorph", "root"].includes(effect.kind))
        continue;
      for (const areaTarget of Object.values(players)) {
        if (
          areaTarget.team === source.team ||
          areaTarget.health <= 0 ||
          distance(source, areaTarget) > ability.range ||
          (areaTarget.statuses.immunity ?? 0) > tick ||
          (areaTarget.statuses.cloak ?? 0) > tick
        )
          continue;
        players[areaTarget.id] = {
          ...areaTarget,
          statuses: { ...areaTarget.statuses, stealth: undefined },
        };
        applyControlStatus(
          players,
          sourceId,
          areaTarget.id,
          effect.kind as Status,
          ability,
          effect.durationTicks ?? 0,
          tick,
          events,
        );
      }
      continue;
    }
    if (ability.target === "enemy-cone") {
      const facingX = source.facingX;
      const facingY = source.facingY;
      const facingLength = Math.max(1, Math.hypot(facingX, facingY));
      const halfAngleCos = Math.cos(Math.PI / 4);
      for (const coneTarget of Object.values(players)) {
        const dx = coneTarget.x - source.x;
        const dy = coneTarget.y - source.y;
        const targetDistance = Math.hypot(dx, dy);
        if (
          coneTarget.team === source.team ||
          coneTarget.health <= 0 ||
          targetDistance > ability.range ||
          targetDistance === 0 ||
          (dx * facingX + dy * facingY) / (targetDistance * facingLength) <
            halfAngleCos ||
          !hasLineOfSight(source, coneTarget) ||
          (coneTarget.statuses.immunity ?? 0) > tick ||
          (coneTarget.statuses.cloak ?? 0) > tick
        )
          continue;
        applyEffect(
          players,
          sourceId,
          coneTarget.id,
          ability,
          effect,
          tick,
          events,
        );
      }
      continue;
    }
    applyEffect(
      players,
      sourceId,
      target?.id,
      ability,
      effect,
      tick,
      events,
      point,
    );
  }
}

function applyEffect(
  players: Record<string, PlayerState>,
  sourceId: string,
  targetId: string | undefined,
  ability: AbilityDefinition,
  effect: AbilityDefinition["effects"][number],
  tick: number,
  events: CombatEvent[],
  point?: Point,
) {
  let source = players[sourceId];
  let target = players[targetId ?? sourceId];
  if (!source) return;
  if (effect.kind === "teleport") {
    const destination =
      point ??
      (target
        ? { x: target.x + (target.team === 0 ? 40 : -40), y: target.y }
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
    if (!walkable(landing)) return;
    players[sourceId] = {
      ...source,
      ...landing,
      rootFrostHits: undefined,
      statuses: { ...source.statuses, root: 0, stun: 0 },
    };
  } else if (effect.kind === "reset-cooldowns")
    players[sourceId] = {
      ...source,
      cooldowns: { [ability.id]: source.cooldowns[ability.id] ?? tick },
    };
  else if (effect.kind === "dispel" && target)
    players[target.id] = dispelOne(target, target.team === source.team, tick);
  else if (effect.kind === "shield" && target)
    players[target.id] = {
      ...target,
      shield: Math.max(target.shield, effect.amount ?? 0),
      shieldAbility:
        (effect.amount ?? 0) >= target.shield
          ? { abilityId: ability.id, specId: source.specId }
          : target.shieldAbility,
    };
  else if (effect.kind === "heal" && target) {
    if (ability.id === "renew") {
      players[target.id] = {
        ...target,
        periodicHealing: {
          amount: 110,
          nextTick: tick + 90,
          ticksLeft: 5,
          sourceId,
        },
      };
      return;
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
      return;
    const frostRootHit =
      (target.statuses.root ?? 0) > tick &&
      ["frostbolt", "ice-lance", "cone-of-cold"].includes(ability.id);
    const rootFrostHits = (target.rootFrostHits ?? 0) + (frostRootHit ? 1 : 0);
    const breaksRoot = frostRootHit && rootFrostHits >= 2;
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
    const effectiveDamage = Math.min(target.health, dealt);
    const health = Math.max(0, target.health - dealt);
    players[target.id] = {
      ...target,
      ...(effectiveDamage > 0
        ? { combatUntilTick: tick + COMBAT_DURATION_TICKS }
        : {}),
      rootFrostHits: breaksRoot
        ? undefined
        : frostRootHit
          ? rootFrostHits
          : target.rootFrostHits,
      health,
      ...(effectiveDamage > 0
        ? {
            cast: applySpellPushback(target, tick, sourceId, ability.id),
          }
        : {}),
      mana:
        ability.id === "mana-burn"
          ? Math.max(0, target.mana - 300)
          : target.mana,
      shield: target.shield - absorbed,
      shieldAbility:
        target.shield - absorbed > 0 ? target.shieldAbility : undefined,
      statuses: {
        ...target.statuses,
        polymorph: undefined,
        incapacitate: undefined,
        stealth: undefined,
        root: breaksRoot ? undefined : target.statuses.root,
      },
    };
    if (effectiveDamage > 0)
      players[sourceId] = {
        ...players[sourceId]!,
        combatUntilTick: tick + COMBAT_DURATION_TICKS,
      };
    if (ability.id === "hemorrhage" || ability.id === "cheap-shot")
      players[sourceId] = {
        ...players[sourceId]!,
        comboTargetId: target.id,
        comboPoints: Math.min(
          5,
          (source.comboTargetId === target.id ? (source.comboPoints ?? 0) : 0) +
            (ability.id === "cheap-shot" ? 2 : 1),
        ),
      };
    if (ability.id === "eviscerate")
      players[sourceId] = { ...players[sourceId]!, comboPoints: 0 };
    events.push({
      tick,
      type: "damage",
      sourceId,
      targetId: target.id,
      amount: effectiveDamage,
      abilityId: ability.id,
      text: `${ability.name} dealt ${effectiveDamage}`,
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
      "incapacitate",
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
    applyControlStatus(
      players,
      sourceId,
      target.id,
      status,
      ability,
      effect.durationTicks ?? 0,
      tick,
      events,
    );
  }
}

function applyControlStatus(
  players: Record<string, PlayerState>,
  sourceId: string,
  targetId: string,
  status: Status,
  ability: AbilityDefinition,
  baseDuration: number,
  tick: number,
  events: CombatEvent[],
) {
  const source = players[sourceId];
  const target = players[targetId];
  if (!source || !target) return;
  const isControl = [
    "stun",
    "fear",
    "polymorph",
    "incapacitate",
    "root",
  ].includes(status);
  const diminishingStatus: DiminishingCategory =
    ability.id === "kidney-shot"
      ? "kidney-shot"
      : status === "incapacitate"
        ? "polymorph"
        : status;
  const prior = target.diminishingReturns?.[diminishingStatus];
  const count = prior && prior.resetsAt > tick ? prior.count : 0;
  if (isControl && count >= 3) return;
  const duration =
    ability.id === "kidney-shot"
      ? (source.comboPoints ?? 1) * TICKS_PER_SECOND
      : baseDuration;
  const until = tick + Math.floor(duration / (isControl ? 2 ** count : 1));
  players[target.id] = {
    ...target,
    ...(status === "stealth"
      ? {
          autoAttackTargetId: undefined,
          nextMainHandSwingTick: undefined,
          nextOffHandSwingTick: undefined,
        }
      : {}),
    ...(status === "root" ? { rootFrostHits: 0 } : {}),
    ...(status === "fear" ? { fearSourceId: sourceId } : {}),
    ...(status === "polymorph"
      ? { polymorphNextHealTick: tick + TICKS_PER_SECOND }
      : {}),
    ...(["silence", "stun", "fear", "polymorph", "incapacitate"].includes(
      status,
    )
      ? { cast: undefined }
      : {}),
    ...(isControl
      ? {
          diminishingReturns: {
            ...target.diminishingReturns,
            [diminishingStatus]: { count: count + 1, resetsAt: until + 450 },
          },
        }
      : {}),
    statuses: { ...target.statuses, [status]: until },
    statusAbilities: {
      ...target.statusAbilities,
      [status]: { abilityId: ability.id, specId: source.specId },
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
    text: `${target.name}: ${ability.name}`,
  });
}

function performAutoAttacks(
  players: Record<string, PlayerState>,
  tick: number,
  events: CombatEvent[],
) {
  const meleeRange = getAbility("subtlety-rogue", "hemorrhage")?.range ?? 0;
  for (const original of Object.values(players)) {
    if (
      original.specId !== "subtlety-rogue" ||
      !original.autoAttackTargetId ||
      original.health <= 0
    )
      continue;
    const target = players[original.autoAttackTargetId];
    if (!target || target.health <= 0 || target.team === original.team) {
      players[original.id] = {
        ...original,
        autoAttackTargetId: undefined,
        nextMainHandSwingTick: undefined,
        nextOffHandSwingTick: undefined,
      };
      continue;
    }
    if (
      controlled(original, tick) ||
      (original.statuses.stealth ?? 0) > tick ||
      distance(original, target) > meleeRange ||
      !hasLineOfSight(original, target)
    )
      continue;

    if ((original.nextMainHandSwingTick ?? tick) <= tick)
      performWeaponSwing(
        players,
        original.id,
        target.id,
        "auto-attack-main-hand",
        115,
        ROGUE_MAIN_HAND_SWING_TICKS,
        tick,
        events,
      );
    const afterMainHand = players[original.id];
    if (
      afterMainHand &&
      players[target.id]!.health > 0 &&
      (afterMainHand.nextOffHandSwingTick ?? tick) <= tick
    )
      performWeaponSwing(
        players,
        original.id,
        target.id,
        "auto-attack-off-hand",
        35,
        ROGUE_OFF_HAND_SWING_TICKS,
        tick,
        events,
      );
  }
}

function performWeaponSwing(
  players: Record<string, PlayerState>,
  sourceId: string,
  targetId: string,
  abilityId: "auto-attack-main-hand" | "auto-attack-off-hand",
  baseDamage: number,
  swingTicks: number,
  tick: number,
  events: CombatEvent[],
) {
  const source = players[sourceId];
  const target = players[targetId];
  if (!source || !target) return;
  const damage =
    (target.statuses.immunity ?? 0) > tick
      ? 0
      : Math.round(
          baseDamage *
            ((target.statuses.evasion ?? 0) > tick ? 0.5 : 1) *
            ((target.statuses["damage-reduction"] ?? 0) > tick ? 0.6 : 1),
        );
  const absorbed = Math.min(target.shield, damage);
  const effectiveDamage = Math.min(target.health, damage - absorbed);
  const health = target.health - effectiveDamage;
  players[sourceId] = {
    ...source,
    combatUntilTick: tick + COMBAT_DURATION_TICKS,
    ...(abilityId === "auto-attack-main-hand"
      ? { nextMainHandSwingTick: tick + swingTicks }
      : { nextOffHandSwingTick: tick + swingTicks }),
  };
  players[targetId] = {
    ...target,
    health,
    ...(effectiveDamage > 0
      ? {
          cast: applySpellPushback(target, tick, sourceId, abilityId),
        }
      : {}),
    shield: target.shield - absorbed,
    shieldAbility:
      target.shield - absorbed > 0 ? target.shieldAbility : undefined,
    combatUntilTick: tick + COMBAT_DURATION_TICKS,
    statuses: {
      ...target.statuses,
      polymorph: undefined,
      incapacitate: undefined,
      stealth: undefined,
    },
  };
  events.push({
    tick,
    type: "damage",
    sourceId,
    targetId,
    abilityId,
    amount: effectiveDamage,
    text: `${source.name}'s ${abilityId === "auto-attack-main-hand" ? "main hand" : "off hand"} hit for ${effectiveDamage}`,
  });
  if (health === 0)
    events.push({
      tick,
      type: "death",
      sourceId,
      targetId,
      text: `${target.name} was defeated`,
    });
}

function applySpellPushback(
  target: PlayerState,
  _tick: number,
  _sourceId: string,
  _attackId: string,
): CastState | undefined {
  const hasPushbackProtection =
    target.shield > 0 &&
    (target.shieldAbility?.abilityId === "ice-barrier" ||
      target.shieldAbility?.abilityId === "power-word-shield");
  if (
    !target.cast ||
    hasPushbackProtection ||
    (target.cast.pushbackCount ?? 0) >= 2
  )
    return target.cast;
  return {
    ...target.cast,
    completesAtTick: target.cast.completesAtTick + TICKS_PER_SECOND / 2,
    pushbackCount: (target.cast.pushbackCount ?? 0) + 1,
  };
}

function regenerate(players: Record<string, PlayerState>, tick: number) {
  for (const player of Object.values(players)) {
    const max = SPECS[player.specId].maxMana;
    players[player.id] = {
      ...player,
      mana: Math.min(
        max,
        player.mana +
          (player.specId === "subtlety-rogue"
            ? tick % ROGUE_ENERGY_TICK_INTERVAL === 0
              ? ROGUE_ENERGY_PER_TICK
              : 0
            : 1),
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
