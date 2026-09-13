import { describe, expect, it } from "vitest";

import { advanceTick, createSimulation, TICKS_PER_SECOND } from "./index.js";

describe("fixed-step simulation", () => {
  it("advances exactly one of thirty ticks per call", () => {
    const result = advanceTick(createSimulation(42), []);

    expect(TICKS_PER_SECOND).toBe(30);
    expect(result.state.tick).toBe(1);
    expect(result.state.seed).toBe(42);
  });

  it("applies commands in stable order and rejects replayed sequences", () => {
    const initial = createSimulation(42);
    const first = advanceTick(initial, [
      { playerId: "player-b", sequence: 0, targetTick: 1, kind: "move" },
      { playerId: "player-a", sequence: 1, targetTick: 1, kind: "stop" },
      { playerId: "player-a", sequence: 0, targetTick: 1, kind: "move" },
    ]);

    expect(
      first.appliedCommands.map(({ playerId, sequence }) => [
        playerId,
        sequence,
      ]),
    ).toEqual([
      ["player-a", 0],
      ["player-a", 1],
      ["player-b", 0],
    ]);

    const second = advanceTick(first.state, [
      { playerId: "player-a", sequence: 1, targetTick: 2, kind: "stop" },
    ]);
    expect(second.appliedCommands).toEqual([]);
  });
});
