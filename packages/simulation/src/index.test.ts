import { describe, expect, it } from "vitest";
import {
  advanceTick,
  botCommands,
  COMBAT_DURATION_TICKS,
  createMatch,
  ROGUE_ENERGY_PER_TICK,
  ROGUE_ENERGY_TICK_INTERVAL,
  ROGUE_MAIN_HAND_SWING_TICKS,
  ROGUE_OFF_HAND_SWING_TICKS,
  TICKS_PER_SECOND,
  type MatchPlayer,
  type MatchState,
  type SimulationCommand,
} from "./index.js";

const roster: MatchPlayer[] = [
  { id: "a", name: "A", team: 0, specId: "frost-mage" },
  { id: "b", name: "B", team: 0, specId: "discipline-priest" },
  { id: "c", name: "C", team: 1, specId: "subtlety-rogue" },
  { id: "d", name: "D", team: 1, specId: "frost-mage" },
];
describe("authoritative match simulation", () => {
  it("regenerates Rogue energy in TBC-style 20-energy ticks every two seconds", () => {
    const initial = createMatch(roster, 42);
    let state: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        c: { ...initial.players.c!, mana: 35 },
      },
    };

    for (let tick = 1; tick < ROGUE_ENERGY_TICK_INTERVAL; tick++)
      state = advanceTick(state, []).state;

    expect(state.players.c!.mana).toBe(35);
    state = advanceTick(state, []).state;
    expect(state.players.c!.mana).toBe(35 + ROGUE_ENERGY_PER_TICK);
  });

  it("caps Rogue energy at 100 and rejects abilities the Rogue cannot afford", () => {
    const initial = createMatch(roster, 42);
    let state: MatchState = {
      ...initial,
      tick: ROGUE_ENERGY_TICK_INTERVAL - 1,
      players: {
        ...initial.players,
        b: { ...initial.players.b!, x: 450, y: 750 },
        c: {
          ...initial.players.c!,
          x: 500,
          y: 750,
          mana: 90,
          statuses: {},
          targetId: "b",
        },
      },
    };

    state = advanceTick(state, []).state;
    expect(state.players.c!.mana).toBe(100);

    state = {
      ...state,
      players: {
        ...state.players,
        c: { ...state.players.c!, mana: 24, globalCooldownUntil: 0 },
      },
    };
    const result = advanceTick(state, [
      {
        playerId: "c",
        sequence: 0,
        targetTick: state.tick + 1,
        kind: "ability",
        abilityId: "hemorrhage",
        targetId: "b",
      },
    ]).state;

    expect(result.players.c!.mana).toBe(24);
    expect(result.events).toHaveLength(0);
  });

  it("continues Rogue pressure with independent main-hand and off-hand swings", () => {
    const initial = createMatch(roster, 42);
    let state: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        b: { ...initial.players.b!, x: 450, y: 750 },
        c: {
          ...initial.players.c!,
          x: 500,
          y: 750,
          statuses: {},
          targetId: "b",
        },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "hemorrhage",
        targetId: "b",
      },
    ]).state;

    const healthAfterHemorrhage = state.players.b!.health;
    for (let tick = 1; tick < ROGUE_OFF_HAND_SWING_TICKS; tick++)
      state = advanceTick(state, []).state;
    expect(state.players.b!.health).toBe(healthAfterHemorrhage);

    state = advanceTick(state, []).state;
    expect(state.events.at(-1)?.abilityId).toBe("auto-attack-off-hand");
    expect(state.players.b!.health).toBe(healthAfterHemorrhage - 35);

    while (state.tick < 1 + ROGUE_MAIN_HAND_SWING_TICKS)
      state = advanceTick(state, []).state;
    expect(state.events.at(-1)?.abilityId).toBe("auto-attack-main-hand");
    expect(state.players.b!.health).toBe(healthAfterHemorrhage - 35 - 115);
  });

  it("does not auto-attack while out of melee range", () => {
    const initial = createMatch(roster, 42);
    let state: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        b: { ...initial.players.b!, x: 450, y: 750 },
        c: {
          ...initial.players.c!,
          x: 500,
          y: 750,
          statuses: {},
          autoAttackTargetId: "b",
          nextMainHandSwingTick: 1,
          nextOffHandSwingTick: 1,
        },
      },
    };
    state = {
      ...state,
      players: {
        ...state.players,
        c: { ...state.players.c!, x: 800 },
      },
    };

    const result = advanceTick(state, []).state;
    expect(result.players.b!.health).toBe(initial.players.b!.health);
    expect(result.events).toHaveLength(0);
  });

  it("applies at most one second of spell pushback from damaging hits", () => {
    const initial = createMatch(roster, 42);
    const state: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        a: {
          ...initial.players.a!,
          x: 450,
          y: 750,
          cast: {
            abilityId: "frostbolt",
            targetId: "c",
            completesAtTick: 100,
          },
        },
        c: {
          ...initial.players.c!,
          x: 500,
          y: 750,
          statuses: {},
          autoAttackTargetId: "a",
          nextMainHandSwingTick: 1,
          nextOffHandSwingTick: 1,
        },
      },
    };

    const result = advanceTick(state, []).state.players.a!;
    expect(result.cast?.completesAtTick).toBe(130);
    expect(result.cast?.pushbackCount).toBe(2);
  });

  it("pushes Priest casts back unless Power Word: Shield is active", () => {
    const initial = createMatch(roster, 42);
    const makeState = (shielded: boolean): MatchState => ({
      ...initial,
      players: {
        ...initial.players,
        b: {
          ...initial.players.b!,
          x: 450,
          y: 750,
          shield: shielded ? 10 : 0,
          shieldAbility: shielded
            ? {
                abilityId: "power-word-shield",
                specId: "discipline-priest",
              }
            : undefined,
          cast: {
            abilityId: "flash-heal",
            targetId: "b",
            completesAtTick: 100,
          },
        },
        c: {
          ...initial.players.c!,
          x: 500,
          y: 750,
          statuses: {},
          autoAttackTargetId: "b",
          nextMainHandSwingTick: 1,
          nextOffHandSwingTick: 100,
        },
      },
    });

    const unshielded = advanceTick(makeState(false), []).state.players.b!;
    expect(unshielded.cast?.completesAtTick).toBe(115);
    expect(unshielded.cast?.pushbackCount).toBe(1);

    const shielded = advanceTick(makeState(true), []).state.players.b!;
    expect(shielded.cast?.completesAtTick).toBe(100);
    expect(shielded.cast?.pushbackCount).toBeUndefined();
    expect(shielded.shield).toBe(0);
    expect(shielded.health).toBeLessThan(initial.players.b!.health);
  });

  it("protects Mage casts from pushback while Ice Barrier is active", () => {
    const initial = createMatch(roster, 42);
    const state: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        a: {
          ...initial.players.a!,
          x: 450,
          y: 750,
          shield: 10,
          shieldAbility: {
            abilityId: "ice-barrier",
            specId: "frost-mage",
          },
          cast: {
            abilityId: "frostbolt",
            targetId: "c",
            completesAtTick: 100,
          },
        },
        c: {
          ...initial.players.c!,
          x: 500,
          y: 750,
          statuses: {},
          autoAttackTargetId: "a",
          nextMainHandSwingTick: 1,
          nextOffHandSwingTick: 100,
        },
      },
    };

    const result = advanceTick(state, []).state.players.a!;
    expect(result.cast?.completesAtTick).toBe(100);
    expect(result.cast?.pushbackCount).toBeUndefined();
    expect(result.shield).toBe(0);
    expect(result.health).toBeLessThan(initial.players.a!.health);
  });

  it("keeps damage dealers and their targets in combat for eight seconds", () => {
    const initial = createMatch(roster, 42);
    const state: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        b: { ...initial.players.b!, x: 400, y: 750, globalCooldownUntil: 0 },
        c: { ...initial.players.c!, x: 500, y: 750, statuses: {} },
      },
    };
    const result = advanceTick(state, [
      {
        playerId: "b",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "shadow-word-death",
        targetId: "c",
      },
    ]).state;

    expect(result.players.b!.combatUntilTick).toBe(
      result.tick + COMBAT_DURATION_TICKS,
    );
    expect(result.players.c!.combatUntilTick).toBe(
      result.tick + COMBAT_DURATION_TICKS,
    );
  });

  it("blocks Stealth in combat and permits it after combat expires", () => {
    const initial = createMatch(roster, 42);
    const inCombat: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        a: { ...initial.players.a!, x: 200, y: 200 },
        b: { ...initial.players.b!, x: 200, y: 300 },
        c: {
          ...initial.players.c!,
          x: 1600,
          y: 900,
          statuses: {},
          globalCooldownUntil: 0,
          combatUntilTick: COMBAT_DURATION_TICKS,
        },
      },
    };
    const blocked = advanceTick(inCombat, [
      {
        playerId: "c",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "stealth",
      },
    ]).state;
    expect(blocked.players.c!.statuses.stealth).toBeUndefined();

    const expired: MatchState = {
      ...blocked,
      players: {
        ...blocked.players,
        c: {
          ...blocked.players.c!,
          globalCooldownUntil: 0,
          combatUntilTick: blocked.tick,
        },
      },
    };
    const stealthed = advanceTick(expired, [
      {
        playerId: "c",
        sequence: 1,
        targetTick: expired.tick + 1,
        kind: "ability",
        abilityId: "stealth",
      },
    ]).state;
    expect(stealthed.players.c!.statuses.stealth).toBeGreaterThan(
      stealthed.tick,
    );
  });

  it("allows the player frame to target self while immune", () => {
    const initial = createMatch(roster, 42);
    const state: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        a: {
          ...initial.players.a!,
          targetId: "c",
          statuses: { immunity: 100 },
        },
      },
    };

    const result = advanceTick(state, [
      {
        playerId: "a",
        sequence: 0,
        targetTick: 1,
        kind: "target",
        targetId: "a",
      },
    ]).state;

    expect(result.players.a!.targetId).toBe("a");
  });

  it("tracks match damage and killing blows for the results screen", () => {
    const initial = createMatch(roster, 42);
    const state: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        b: { ...initial.players.b!, targetId: "c", globalCooldownUntil: 0 },
        c: { ...initial.players.c!, x: 400, y: 750, health: 200, statuses: {} },
      },
    };
    const result = advanceTick(state, [
      {
        playerId: "b",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "shadow-word-death",
        targetId: "c",
      },
    ]).state;

    expect(result.stats.b).toEqual({
      damageDone: 200,
      healingDone: 0,
      killingBlows: 1,
    });
  });

  it("Dispels one harmful effect from a friendly target", () => {
    const initial = createMatch(roster, 42);
    const state: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        a: { ...initial.players.a!, statuses: { root: 100, slow: 100 } },
        b: {
          ...initial.players.b!,
          y: 700,
          targetId: "a",
          globalCooldownUntil: 0,
        },
      },
    };
    const result = advanceTick(state, [
      {
        playerId: "b",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "dispel-magic",
        targetId: "a",
      },
    ]).state.players.a!;

    expect(result.statuses.root).toBeUndefined();
    expect(result.statuses.slow).toBe(100);
  });

  it("Dispels one beneficial effect from an enemy target", () => {
    const initial = createMatch(roster, 42);
    const state: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        b: { ...initial.players.b!, targetId: "c", globalCooldownUntil: 0 },
        c: {
          ...initial.players.c!,
          x: 450,
          y: 750,
          shield: 300,
          statuses: { "damage-reduction": 100 },
        },
      },
    };
    const result = advanceTick(state, [
      {
        playerId: "b",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "dispel-magic",
        targetId: "c",
      },
    ]).state.players.c!;

    expect(result.shield).toBe(0);
    expect(result.statuses["damage-reduction"]).toBe(100);
  });

  it("starts one bounded jump and rejects an airborne repeat", () => {
    const initial = createMatch(roster, 42);
    const first = advanceTick(initial, [
      { playerId: "a", sequence: 0, targetTick: 1, kind: "jump" },
    ]).state;
    expect(first.players.a?.jumpStartedTick).toBe(1);
    expect(first.players.a?.jumpUntilTick).toBe(25);
    const repeated = advanceTick(first, [
      { playerId: "a", sequence: 1, targetTick: 2, kind: "jump" },
    ]).state;
    expect(repeated.players.a?.jumpUntilTick).toBe(25);
  });
  it("normalizes camera-relative movement so analog vectors cannot increase speed", () => {
    const state = createMatch(roster, 42);
    const result = advanceTick(state, [
      { playerId: "a", sequence: 0, targetTick: 1, kind: "move", x: 2, y: 2 },
    ]).state.players.a!;
    expect(Math.hypot(result.x - 250, result.y - 450)).toBeLessThan(12);
    expect(result.x).toBeGreaterThan(250);
    expect(result.y).toBeGreaterThan(450);
  });
  it("moves Rogues at seventy percent speed while Stealthed", () => {
    const initial = createMatch(roster, 42);
    const stealthed = advanceTick(initial, [
      { playerId: "c", sequence: 0, targetTick: 1, kind: "move", x: 1, y: 0 },
    ]).state.players.c!;
    const visibleState: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        c: { ...initial.players.c!, statuses: {} },
      },
    };
    const visible = advanceTick(visibleState, [
      { playerId: "c", sequence: 0, targetTick: 1, kind: "move", x: 1, y: 0 },
    ]).state.players.c!;

    expect(stealthed.x - initial.players.c!.x).toBe(9);
    expect(visible.x - initial.players.c!.x).toBe(13);
  });
  it("does not let batched movement intents make a Stealthed Rogue run fast", () => {
    const initial = createMatch(roster, 42);
    const result = advanceTick(initial, [
      { playerId: "c", sequence: 0, targetTick: 1, kind: "move", x: 1, y: 0 },
      { playerId: "c", sequence: 1, targetTick: 1, kind: "move", x: 1, y: 0 },
    ]).state.players.c!;

    expect(result.statuses.stealth).toBeGreaterThan(1);
    expect(result.x - initial.players.c!.x).toBe(9);
  });
  it("uses Stealth speed when movement and Stealth enter the same server tick", () => {
    const initial = createMatch(roster, 42);
    const visibleState: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        c: { ...initial.players.c!, statuses: {}, globalCooldownUntil: 0 },
      },
    };
    const result = advanceTick(visibleState, [
      { playerId: "c", sequence: 0, targetTick: 1, kind: "move", x: 1, y: 0 },
      {
        playerId: "c",
        sequence: 1,
        targetTick: 1,
        kind: "ability",
        abilityId: "stealth",
      },
    ]).state.players.c!;

    expect(result.statuses.stealth).toBeGreaterThan(1);
    expect(result.x - initial.players.c!.x).toBe(9);
  });
  it("forces feared players to flee from the caster instead of accepting movement", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        b: { ...state.players.b!, x: 400, y: 450 },
        c: { ...state.players.c!, x: 470, y: 450, statuses: {} },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "b",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "psychic-scream",
        targetId: "c",
      },
    ]).state;
    const firstFearedX = state.players.c!.x;
    expect(state.players.c!.statuses.fear).toBeGreaterThan(state.tick);
    expect(state.players.c!.fearSourceId).toBe("b");
    expect(firstFearedX).toBeGreaterThan(470);

    state = advanceTick(state, [
      { playerId: "c", sequence: 0, targetTick: 2, kind: "move", x: -1, y: 0 },
    ]).state;
    expect(state.players.c!.x).toBeGreaterThan(firstFearedX);
  });
  it("casts Psychic Scream without a target, fearing every nearby enemy", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, x: 450, y: 450 },
        b: { ...state.players.b!, x: 400, y: 450 },
        c: { ...state.players.c!, x: 600, y: 450, statuses: {} },
        d: { ...state.players.d!, x: 690, y: 450, statuses: {} },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "b",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "psychic-scream",
      },
    ]).state;

    expect(state.players.b!.targetId).toBeUndefined();
    expect(state.players.a!.statuses.fear).toBeUndefined();
    expect(state.players.c!.statuses.fear).toBeGreaterThan(state.tick);
    expect(state.players.d!.statuses.fear).toBeGreaterThan(state.tick);
    expect(
      state.events.filter(
        (event) =>
          event.type === "control" && event.abilityId === "psychic-scream",
      ),
    ).toHaveLength(2);
  });
  it("Ice Block prevents damage and actions for its duration", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        c: { ...state.players.c!, x: 300, y: 450, statuses: {} },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "a",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "ice-block",
      },
      {
        playerId: "c",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "hemorrhage",
        targetId: "a",
      },
    ]).state;
    expect(state.players.a!.health).toBe(1900);
    state = advanceTick(state, [
      { playerId: "a", sequence: 1, targetTick: 2, kind: "move", x: 1, y: 0 },
    ]).state;
    expect(state.players.a!.x).toBe(250);
  });
  it("allows Ice Block to be canceled early", () => {
    let state = createMatch(roster, 42);
    state = advanceTick(state, [
      {
        playerId: "a",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "ice-block",
      },
    ]).state;
    expect(state.players.a!.statuses.immunity).toBeGreaterThan(state.tick);

    state = advanceTick(state, [
      {
        playerId: "a",
        sequence: 1,
        targetTick: 2,
        kind: "cancel-aura",
        abilityId: "ice-block",
      },
    ]).state;
    expect(state.players.a!.statuses.immunity).toBe(0);
    expect(state.events.at(-1)?.text).toBe("A canceled Ice Block");
  });
  it("keeps Stealth through Shadowstep so Cheap Shot can open", () => {
    let state = createMatch(roster, 42);
    expect(state.players.c!.statuses.stealth).toBe(TICKS_PER_SECOND * 600);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, x: 400, y: 600 },
        c: { ...state.players.c!, x: 600, y: 600 },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "shadowstep",
        targetId: "a",
      },
    ]).state;
    expect(state.players.c!.statuses.stealth).toBeGreaterThan(state.tick);
    expect(
      Math.abs(state.players.c!.x - state.players.a!.x),
    ).toBeLessThanOrEqual(180);
    for (let i = 0; i < 30; i++) state = advanceTick(state, []).state;
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 1,
        targetTick: state.tick + 1,
        kind: "ability",
        abilityId: "cheap-shot",
        targetId: "a",
      },
    ]).state;
    expect(state.players.a!.statuses.stun).toBeGreaterThan(state.tick);
    expect(state.players.c!.comboPoints).toBe(2);
    expect(state.players.c!.comboTargetId).toBe("a");
  });
  it("regenerates ten percent of maximum health each second while Polymorphed", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, x: 400, y: 600 },
        c: {
          ...state.players.c!,
          x: 600,
          y: 600,
          health: 1000,
          statuses: {},
        },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "a",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "polymorph",
        targetId: "c",
      },
    ]).state;
    for (let i = 0; i < 45; i++) state = advanceTick(state, []).state;
    expect(state.players.c!.health).toBe(1000);
    for (let i = 0; i < 29; i++) state = advanceTick(state, []).state;
    expect(state.players.c!.health).toBe(1000);
    state = advanceTick(state, []).state;
    expect(state.players.c!.health).toBe(1220);
    expect(state.events.at(-1)?.text).toBe("Polymorph regenerated 220");

    state = advanceTick(state, [
      {
        playerId: "a",
        sequence: 1,
        targetTick: state.tick + 1,
        kind: "ability",
        abilityId: "fire-blast",
        targetId: "c",
      },
    ]).state;
    expect(state.players.c!.statuses.polymorph).toBeUndefined();
    const healthAfterBreak = state.players.c!.health;
    for (let i = 0; i < 40; i++) state = advanceTick(state, []).state;
    expect(state.players.c!.health).toBe(healthAfterBreak);
  });
  it("treats Gouge as breakable incapacitation without Polymorph healing", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, x: 400, y: 600, health: 1000 },
        c: { ...state.players.c!, x: 445, y: 600, statuses: {} },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "gouge",
        targetId: "a",
      },
    ]).state;

    expect(state.players.a!.statuses.incapacitate).toBeGreaterThan(state.tick);
    expect(state.players.a!.statuses.polymorph).toBeUndefined();
    for (let i = 0; i < 35; i++) state = advanceTick(state, []).state;
    expect(state.players.a!.health).toBe(1000);
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 1,
        targetTick: state.tick + 1,
        kind: "ability",
        abilityId: "hemorrhage",
        targetId: "a",
      },
    ]).state;
    expect(state.players.a!.statuses.incapacitate).toBeUndefined();
  });
  it("Renew heals on scheduled ticks instead of instantly", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, y: 470, health: 1000 },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "b",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "renew",
        targetId: "a",
      },
    ]).state;
    expect(state.players.a!.health).toBe(1000);
    for (let tick = 0; tick < 90; tick++) state = advanceTick(state, []).state;
    expect(state.players.a!.health).toBe(1110);
  });
  it("starts a four-player match at 30 Hz", () => {
    const match = createMatch(roster, 42);
    expect(TICKS_PER_SECOND).toBe(30);
    expect(match.phase).toBe("running");
    expect(advanceTick(match, []).state.tick).toBe(1);
  });
  it("runs deterministic bot matches that produce combat", () => {
    const run = () => {
      let state = createMatch(roster, 42);
      let damage = 0;
      for (let i = 0; i < 900; i++) {
        state = advanceTick(
          state,
          botCommands(
            state,
            roster.map((p) => p.id),
          ),
        ).state;
        damage += state.events.filter((e) => e.type === "damage").length;
      }
      return { state, damage };
    };
    const first = run();
    expect(first.damage).toBeGreaterThan(5);
    expect(run()).toEqual(first);
  });
  it("prevents bots from targeting stealthed enemies outside detection range", () => {
    const stealthRoster: MatchPlayer[] = [
      { id: "rogue", name: "Rogue", team: 0, specId: "subtlety-rogue" },
      { id: "priest", name: "Priest", team: 0, specId: "discipline-priest" },
      { id: "bot", name: "Bot", team: 1, specId: "frost-mage" },
      { id: "partner", name: "Partner", team: 1, specId: "subtlety-rogue" },
    ];
    const initial = createMatch(stealthRoster, 42);
    let state: MatchState = {
      ...initial,
      players: {
        ...initial.players,
        rogue: {
          ...initial.players.rogue!,
          x: 600,
          y: 600,
          statuses: {},
        },
        priest: { ...initial.players.priest!, x: 900, y: 600 },
        bot: { ...initial.players.bot!, x: 700, y: 600 },
      },
    };

    const visibleCommands = botCommands(state, ["bot"]);
    expect(
      visibleCommands[0]?.kind === "ability"
        ? visibleCommands[0].targetId
        : undefined,
    ).toBe("rogue");

    state = advanceTick(state, [
      {
        playerId: "rogue",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "vanish",
      },
    ]).state;
    const commands = botCommands(state, ["bot"]);
    expect(commands).toHaveLength(1);
    expect(
      commands[0]?.kind === "ability" ? commands[0].targetId : undefined,
    ).toBe("priest");
  });
  it("cancels a hostile cast when its target Vanishes before completion", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: {
          ...state.players.a!,
          x: 500,
          y: 600,
          cast: {
            abilityId: "frostbolt",
            targetId: "c",
            completesAtTick: 2,
          },
        },
        c: {
          ...state.players.c!,
          x: 600,
          y: 600,
          statuses: {},
        },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "vanish",
      },
    ]).state;
    state = advanceTick(state, []).state;

    expect(state.players.c!.health).toBe(2200);
    expect(state.players.c!.statuses.stealth).toBeGreaterThan(state.tick);
    expect(state.events).toHaveLength(0);
  });
  it("reduces repeated control duration and then grants immunity", () => {
    let state = createMatch(roster, 42);
    for (let count = 0; count < 4; count++) {
      state = {
        ...state,
        players: {
          ...state.players,
          a: {
            ...state.players.a!,
            x: 400,
            y: 600,
            cooldowns: {},
            globalCooldownUntil: 0,
          },
          c: { ...state.players.c!, x: 600, y: 600, statuses: {} },
        },
      };
      state = advanceTick(state, [
        {
          playerId: "a",
          sequence: count,
          targetTick: state.tick + 1,
          kind: "ability",
          abilityId: "frost-nova",
          targetId: "c",
        },
      ]).state;
      expect((state.players.c!.statuses.root ?? state.tick) - state.tick).toBe(
        count === 3 ? 0 : Math.floor(150 / 2 ** count),
      );
    }
  });
  it("casts Frost Nova without a target, rooting and revealing every nearby enemy", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, x: 400, y: 600 },
        b: { ...state.players.b!, x: 450, y: 600 },
        c: {
          ...state.players.c!,
          x: 600,
          y: 600,
          statuses: { stealth: 600 },
        },
        d: { ...state.players.d!, x: 700, y: 600 },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "a",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "frost-nova",
      },
    ]).state;

    expect(state.players.a!.targetId).toBeUndefined();
    expect(state.players.b!.statuses.root).toBeUndefined();
    expect(state.players.c!.statuses.root).toBeGreaterThan(state.tick);
    expect(state.players.d!.statuses.root).toBeGreaterThan(state.tick);
    expect(state.players.c!.statuses.stealth).toBeUndefined();
    expect(
      state.events.filter(
        (event) => event.type === "control" && event.abilityId === "frost-nova",
      ),
    ).toHaveLength(2);
  });
  it("casts Cone of Cold without a target and hits every enemy in front", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: {
          ...state.players.a!,
          x: 500,
          y: 600,
          facingX: 1,
          facingY: 0,
          targetId: "d",
        },
        b: { ...state.players.b!, x: 550, y: 600 },
        c: {
          ...state.players.c!,
          x: 680,
          y: 600,
          statuses: { stealth: 600 },
        },
        d: { ...state.players.d!, x: 300, y: 600 },
      },
    };

    state = advanceTick(state, [
      {
        playerId: "a",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "cone-of-cold",
      },
    ]).state;

    expect(state.players.b!.health).toBe(2100);
    expect(state.players.c!.health).toBe(2020);
    expect(state.players.d!.health).toBe(1900);
    expect(state.players.c!.statuses.slow).toBeGreaterThan(state.tick);
    expect(state.players.c!.statusAbilities?.slow).toEqual({
      abilityId: "cone-of-cold",
      specId: "frost-mage",
    });
    expect(state.players.c!.statuses.stealth).toBeUndefined();
    expect(state.players.d!.statuses.slow).toBeUndefined();
    expect(
      state.events.filter(
        (event) =>
          event.type === "damage" && event.abilityId === "cone-of-cold",
      ),
    ).toHaveLength(1);
  });
  it("breaks Frost Nova on the second damaging frost spell", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, x: 400, y: 600 },
        c: { ...state.players.c!, x: 600, y: 600, statuses: {} },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "a",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "frost-nova",
      },
    ]).state;
    expect(state.players.c!.rootFrostHits).toBe(0);

    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, globalCooldownUntil: 0 },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "a",
        sequence: 1,
        targetTick: state.tick + 1,
        kind: "ability",
        abilityId: "ice-lance",
        targetId: "c",
      },
    ]).state;
    expect(state.players.c!.rootFrostHits).toBe(1);
    expect(state.players.c!.statuses.root).toBeGreaterThan(state.tick);

    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, globalCooldownUntil: 0 },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "a",
        sequence: 2,
        targetTick: state.tick + 1,
        kind: "ability",
        abilityId: "ice-lance",
        targetId: "c",
      },
    ]).state;
    expect(state.players.c!.rootFrostHits).toBeUndefined();
    expect(state.players.c!.statuses.root).toBeUndefined();
  });
  it("requires and consumes combo points for a finisher", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: { ...state.players, c: { ...state.players.c!, x: 290, y: 450 } },
    };
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "eviscerate",
        targetId: "a",
      },
    ]).state;
    expect(state.players.a!.health).toBe(1900);
    state = {
      ...state,
      players: {
        ...state.players,
        c: { ...state.players.c!, comboPoints: 5, comboTargetId: "a" },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 1,
        targetTick: 2,
        kind: "ability",
        abilityId: "eviscerate",
        targetId: "a",
      },
    ]).state;
    expect(state.players.a!.health).toBe(1460);
    expect(state.players.c!.comboPoints).toBe(0);
  });
  it("stuns for three seconds with Cheap Shot", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, x: 400, y: 600 },
        c: { ...state.players.c!, x: 480, y: 600 },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "cheap-shot",
        targetId: "a",
      },
    ]).state;
    expect(state.players.a!.statuses.stun).toBe(
      state.tick + 3 * TICKS_PER_SECOND,
    );
  });
  it("stuns for five seconds with a full Kidney Shot", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, x: 400, y: 600 },
        c: {
          ...state.players.c!,
          x: 480,
          y: 600,
          statuses: {},
          comboPoints: 5,
          comboTargetId: "a",
        },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "kidney-shot",
        targetId: "a",
      },
    ]).state;
    expect(state.players.a!.statuses.stun).toBe(
      state.tick + 5 * TICKS_PER_SECOND,
    );
    expect(state.players.c!.comboPoints).toBe(0);
  });
  it("does not diminish a full Kidney Shot after Cheap Shot", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, x: 400, y: 600 },
        c: { ...state.players.c!, x: 480, y: 600 },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "cheap-shot",
        targetId: "a",
      },
    ]).state;
    for (let tick = 0; tick < TICKS_PER_SECOND; tick++)
      state = advanceTick(state, []).state;
    state = {
      ...state,
      players: {
        ...state.players,
        c: {
          ...state.players.c!,
          comboPoints: 5,
          comboTargetId: "a",
        },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 1,
        targetTick: state.tick + 1,
        kind: "ability",
        abilityId: "kidney-shot",
        targetId: "a",
      },
    ]).state;
    expect(state.players.a!.statuses.stun).toBe(
      state.tick + 5 * TICKS_PER_SECOND,
    );
  });
  it("starts a fresh combo-point stack when generating on another target", () => {
    let state = createMatch(roster, 42);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a!, x: 470, y: 600 },
        b: { ...state.players.b!, x: 530, y: 600 },
        c: { ...state.players.c!, x: 500, y: 600, statuses: {} },
      },
    };
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "hemorrhage",
        targetId: "a",
      },
    ]).state;
    expect(state.players.c!.comboTargetId).toBe("a");
    expect(state.players.c!.comboPoints).toBe(1);

    for (let i = 0; i < 30; i++) state = advanceTick(state, []).state;
    state = advanceTick(state, [
      {
        playerId: "c",
        sequence: 1,
        targetTick: state.tick + 1,
        kind: "ability",
        abilityId: "hemorrhage",
        targetId: "b",
      },
    ]).state;
    expect(state.players.c!.comboTargetId).toBe("b");
    expect(state.players.c!.comboPoints).toBe(1);
  });
  it("orders intent deterministically and rejects replayed sequences", () => {
    const command = (sequence: number): SimulationCommand => ({
      playerId: "a",
      sequence,
      targetTick: 1,
      kind: "move",
      x: 1,
      y: 0,
    });
    const first = advanceTick(createMatch(roster, 42), [
      command(1),
      command(0),
    ]);
    expect(first.appliedCommands.map(({ sequence }) => sequence)).toEqual([0]);
    expect(
      advanceTick(first.state, [{ ...command(1), targetTick: 2 }])
        .appliedCommands,
    ).toEqual([]);
  });
  it("keeps damage server-derived", () => {
    const initial = createMatch(roster, 42);
    const closeRange = {
      ...initial,
      players: {
        ...initial.players,
        c: { ...initial.players.c!, x: 500, statuses: {} },
      },
    };
    const match = advanceTick(closeRange, [
      {
        playerId: "a",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "fire-blast",
        targetId: "c",
      },
    ]).state;
    expect(match.players.c?.health).toBe(1990);
    expect(match.events.at(-1)?.type).toBe("damage");
  });
  it("caps movement per tick even under a command flood", () => {
    const initial = createMatch(roster, 42);
    const commands: SimulationCommand[] = Array.from(
      { length: 100 },
      (_, sequence) => ({
        playerId: "a",
        sequence,
        targetTick: 1,
        kind: "move",
        x: 1,
        y: 0,
      }),
    );
    expect(advanceTick(initial, commands).state.players.a!.x).toBe(261);
  });
  it("blocks spells through pillars", () => {
    const initial = createMatch(roster, 42);
    const players = {
      ...initial.players,
      a: { ...initial.players.a!, x: 600, y: 350 },
      c: { ...initial.players.c!, x: 1000, y: 350 },
    };
    const next = advanceTick({ ...initial, players }, [
      {
        playerId: "a",
        sequence: 0,
        targetTick: 1,
        kind: "ability",
        abilityId: "fire-blast",
        targetId: "c",
      },
    ]).state;
    expect(next.players.c!.health).toBe(2200);
    expect(next.players.a!.mana).toBe(initial.players.a!.mana);
  });
  it("cancels a completed cast if its target moved out of range", () => {
    const initial = createMatch(roster, 42);
    const players = {
      ...initial.players,
      a: {
        ...initial.players.a!,
        cast: { abilityId: "frostbolt", targetId: "c", completesAtTick: 1 },
      },
      c: { ...initial.players.c!, x: 1990, y: 1100 },
    };
    const next = advanceTick({ ...initial, players }, []).state;
    expect(next.players.c!.health).toBe(2200);
    expect(next.players.a!.cast).toBeUndefined();
  });
});
