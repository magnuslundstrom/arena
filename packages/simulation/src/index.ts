export const TICKS_PER_SECOND = 30 as const;
export const TICK_DURATION_MS = 1_000 / TICKS_PER_SECOND;

export interface SimulationCommand {
  readonly playerId: string;
  readonly sequence: number;
  readonly targetTick: number;
  readonly kind: string;
}

export interface SimulationState {
  readonly tick: number;
  readonly seed: number;
  readonly lastAcceptedSequenceByPlayer: Readonly<Record<string, number>>;
}

export interface TickResult {
  readonly state: SimulationState;
  readonly appliedCommands: readonly SimulationCommand[];
}

export function createSimulation(seed: number): SimulationState {
  if (!Number.isSafeInteger(seed)) {
    throw new TypeError("Simulation seed must be a safe integer");
  }

  return {
    tick: 0,
    seed,
    lastAcceptedSequenceByPlayer: {},
  };
}

export function advanceTick(
  state: SimulationState,
  commands: readonly SimulationCommand[],
): TickResult {
  const nextTick = state.tick + 1;
  const sequences = { ...state.lastAcceptedSequenceByPlayer };
  const appliedCommands = commands
    .filter((command) => command.targetTick === nextTick)
    .sort(compareCommands)
    .filter((command) => {
      const previous = sequences[command.playerId] ?? -1;
      if (command.sequence <= previous) return false;
      sequences[command.playerId] = command.sequence;
      return true;
    });

  return {
    state: {
      tick: nextTick,
      seed: state.seed,
      lastAcceptedSequenceByPlayer: sequences,
    },
    appliedCommands,
  };
}

function compareCommands(
  left: SimulationCommand,
  right: SimulationCommand,
): number {
  return (
    left.playerId.localeCompare(right.playerId, "en") ||
    left.sequence - right.sequence ||
    left.kind.localeCompare(right.kind, "en")
  );
}
