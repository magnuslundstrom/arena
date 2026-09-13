import { describe, expect, it } from "vitest";
import {
  advanceTick,
  createMatch,
  TICKS_PER_SECOND,
  type MatchPlayer,
  type SimulationCommand,
} from "./index.js";

const roster: MatchPlayer[] = [
  { id: "a", name: "A", team: 0, specId: "frost-mage" },
  { id: "b", name: "B", team: 0, specId: "discipline-priest" },
  { id: "c", name: "C", team: 1, specId: "subtlety-rogue" },
  { id: "d", name: "D", team: 1, specId: "frost-mage" },
];
describe("authoritative match simulation", () => {
  it("starts a four-player match at 30 Hz", () => {
    const match = createMatch(roster, 42);
    expect(TICKS_PER_SECOND).toBe(30);
    expect(match.phase).toBe("running");
    expect(advanceTick(match, []).state.tick).toBe(1);
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
    expect(first.appliedCommands.map(({ sequence }) => sequence)).toEqual([
      0, 1,
    ]);
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
        c: { ...initial.players.c!, x: 1200 },
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
});
