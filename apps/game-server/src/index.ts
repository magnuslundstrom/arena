import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import Fastify from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import {
  ClientAddBotSchema,
  ClientTeamSchema,
  ClientHelloSchema,
  PlayerIntentSchema,
  PROTOCOL_VERSION,
  type ServerSnapshot,
  type ServerWelcome,
} from "@arena/protocol";
import {
  advanceTick,
  botCommands,
  canObservePlayer,
  createMatch,
  TICK_DURATION_MS,
  type MatchPlayer,
  type MatchState,
  type SimulationCommand,
} from "@arena/simulation";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const server = Fastify({ logger: true });
const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const clients = new Map<WebSocket, MatchPlayer>();
const clientRooms = new Map<WebSocket, string>();
type GameRoom = {
  state: MatchState;
  commands: SimulationCommand[];
  bots: MatchPlayer[];
};
const PLAYGROUND_ID = "playground";
const TARGET_DUMMIES: readonly MatchPlayer[] = [
  { id: "dummy-cloth", name: "Cloth Dummy", team: 1, specId: "frost-mage" },
  {
    id: "dummy-leather",
    name: "Leather Dummy",
    team: 1,
    specId: "subtlety-rogue",
  },
  {
    id: "dummy-healer",
    name: "Healer Dummy",
    team: 1,
    specId: "discipline-priest",
  },
];

function createPlayground(): MatchState {
  const state = createMatch(TARGET_DUMMIES, 2026);
  const dummySpacing = 300;
  const players = Object.fromEntries(
    TARGET_DUMMIES.map((dummy, index) => [
      dummy.id,
      {
        ...state.players[dummy.id]!,
        x: 1700,
        y: 300 + index * dummySpacing,
        facingX: -1,
        facingY: 0,
        statuses: {},
      },
    ]),
  );
  return { ...state, phase: "running", map: "playground", players };
}

function addPlaygroundPlayer(
  state: MatchState,
  player: MatchPlayer,
): MatchState {
  const fresh = createMatch([player], state.seed);
  return {
    ...state,
    phase: "running",
    players: { ...state.players, [player.id]: fresh.players[player.id]! },
    stats: { ...state.stats, [player.id]: fresh.stats[player.id]! },
  };
}

function removePlaygroundPlayer(
  state: MatchState,
  playerId: string,
): MatchState {
  const players = { ...state.players };
  const stats = { ...state.stats };
  delete players[playerId];
  delete stats[playerId];
  return { ...state, players, stats };
}

function keepPlaygroundRunning(state: MatchState): MatchState {
  const players = Object.fromEntries(
    Object.values(state.players).map((player) => {
      if (player.health > 0) return [player.id, player];
      const fresh = createMatch(
        [
          {
            id: player.id,
            name: player.name,
            specId: player.specId,
            team: player.team,
          },
        ],
        state.seed,
      ).players[player.id]!;
      return [
        player.id,
        {
          ...fresh,
          x: player.x,
          y: player.y,
          ...(player.id.startsWith("dummy-") ? { statuses: {} } : {}),
        },
      ];
    }),
  );
  const { winnerTeam: _winnerTeam, ...ongoing } = state;
  return { ...ongoing, phase: "running", map: "playground", players };
}

const rooms = new Map<string, GameRoom>([
  ["public", { state: createMatch([], 2026), commands: [], bots: [] }],
  [PLAYGROUND_ID, { state: createPlayground(), commands: [], bots: [] }],
]);
const practice = new Map<
  WebSocket,
  { state: MatchState; commands: SimulationCommand[]; bots: string[] }
>();

server.get("/health", async () => ({
  status: "ok",
  players: clients.size,
  tick: rooms.get("public")?.state.tick ?? 0,
}));
server.get("/status", async () => {
  const publicPlayers = [...clientRooms.values()].filter(
    (id) => id === "public",
  );
  return {
    onlinePlayers: clients.size,
    activeMatches:
      [...rooms.entries()].filter(
        ([id, room]) => id !== PLAYGROUND_ID && room.state.phase === "running",
      ).length + practice.size,
    playgroundPlayers: [...clientRooms.values()].filter(
      (id) => id === PLAYGROUND_ID,
    ).length,
    queuePlayers: publicPlayers.length,
    queueCapacity: 4,
  };
});
server.server.on("upgrade", (request, socket, head) => {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  if (url.pathname !== "/connect") return socket.destroy();
  sockets.handleUpgrade(request, socket, head, (webSocket) =>
    sockets.emit("connection", webSocket, request),
  );
});

sockets.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let message: unknown;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return socket.close(1007, "Invalid JSON");
    }
    const joined = clients.get(socket);
    if (!joined) {
      if (!Value.Check(ClientHelloSchema, message))
        return socket.close(1008, "Expected client hello");
      const roomId = message.practice
        ? "practice"
        : (message.roomId ?? "public");
      const isPlayground = roomId === PLAYGROUND_ID;
      const gameRoom = rooms.get(roomId) ?? {
        state: createMatch([], 2026),
        commands: [],
        bots: [],
      };
      if (!message.practice && !rooms.has(roomId)) rooms.set(roomId, gameRoom);
      const roomPlayers = [...clients.entries()]
        .filter(([ws]) => clientRooms.get(ws) === roomId)
        .map(([, p]) => p);
      if (
        !message.practice &&
        !isPlayground &&
        Object.keys(gameRoom.state.players).length >= 4
      )
        return socket.close(1013, "Arena is full");
      const player: MatchPlayer = {
        id: randomUUID(),
        name: message.name,
        specId: message.specId,
        team: isPlayground
          ? 0
          : Object.values(gameRoom.state.players).filter((p) => p.team === 0)
                .length < 2
            ? 0
            : 1,
      };
      clients.set(socket, player);
      clientRooms.set(socket, roomId);
      if (message.practice) {
        const human = { ...player, team: 0 as const };
        clients.set(socket, human);
        const roster: MatchPlayer[] = [
          human,
          {
            id: "bot-ally",
            name: "Allied Priest",
            team: 0,
            specId: "discipline-priest",
          },
          {
            id: "bot-priest",
            name: "Enemy Priest",
            team: 1,
            specId: "discipline-priest",
          },
          {
            id: "bot-rogue",
            name: "Enemy Rogue",
            team: 1,
            specId: "subtlety-rogue",
          },
        ];
        practice.set(socket, {
          state: createMatch(roster, 2026),
          commands: [],
          bots: roster.slice(1).map((p) => p.id),
        });
      } else if (isPlayground) {
        gameRoom.state = addPlaygroundPlayer(gameRoom.state, player);
      } else
        gameRoom.state = createMatch(
          [
            ...[...clients.entries()]
              .filter(([ws]) => clientRooms.get(ws) === roomId)
              .map(([, p]) => p),
            ...gameRoom.bots,
          ],
          2026,
        );
      const welcome: ServerWelcome = {
        kind: "server.welcome",
        protocolVersion: PROTOCOL_VERSION,
        playerId: player.id,
        team: message.practice ? 0 : player.team,
      };
      socket.send(JSON.stringify(welcome));
      broadcast();
      return;
    }
    if (Value.Check(ClientTeamSchema, message)) {
      const roomId = clientRooms.get(socket);
      const gameRoom = roomId ? rooms.get(roomId) : undefined;
      if (!roomId || !gameRoom || gameRoom.state.phase !== "waiting") return;
      const roomEntries = [...clients.entries()].filter(
        ([ws]) => clientRooms.get(ws) === roomId,
      );
      if (
        joined.team === message.team ||
        Object.values(gameRoom.state.players).filter(
          (player) => player.team === message.team,
        ).length >= 2
      )
        return;
      const moved = { ...joined, team: message.team as 0 | 1 };
      clients.set(socket, moved);
      gameRoom.commands = [];
      gameRoom.state = createMatch(
        [
          ...roomEntries.map(([ws, player]) =>
            ws === socket ? moved : player,
          ),
          ...gameRoom.bots,
        ],
        2026,
      );
      broadcast();
      return;
    }
    if (Value.Check(ClientAddBotSchema, message)) {
      const roomId = clientRooms.get(socket);
      const gameRoom = roomId ? rooms.get(roomId) : undefined;
      if (
        !roomId ||
        roomId === "public" ||
        roomId === PLAYGROUND_ID ||
        !gameRoom ||
        gameRoom.state.phase !== "waiting" ||
        Object.keys(gameRoom.state.players).length >= 4 ||
        Object.values(gameRoom.state.players).filter(
          (player) => player.team === message.team,
        ).length >= 2
      )
        return;
      const bot: MatchPlayer = {
        id: `bot-${randomUUID()}`,
        name: `Bot ${
          message.specId === "frost-mage"
            ? "Mage"
            : message.specId === "subtlety-rogue"
              ? "Rogue"
              : "Priest"
        }`,
        team: message.team as 0 | 1,
        specId: message.specId,
      };
      gameRoom.bots.push(bot);
      const humans = [...clients.entries()]
        .filter(([ws]) => clientRooms.get(ws) === roomId)
        .map(([, player]) => player);
      gameRoom.commands = [];
      gameRoom.state = createMatch([...humans, ...gameRoom.bots], 2026);
      broadcast();
      return;
    }
    if (!Value.Check(PlayerIntentSchema, message)) return;
    const practiceRoom = practice.get(socket);
    const gameRoom = rooms.get(clientRooms.get(socket) ?? "public");
    const pending = practiceRoom?.commands ?? gameRoom?.commands;
    if (!pending) return;
    if (pending.filter((c) => c.playerId === joined.id).length >= 4) return;
    const base = {
      playerId: joined.id,
      sequence: message.sequence,
      targetTick: (practiceRoom?.state.tick ?? gameRoom?.state.tick ?? 0) + 1,
    };
    const intent = message.intent;
    if (intent.type === "move")
      pending.push({ ...base, kind: "move", x: intent.x, y: intent.y });
    else if (intent.type === "jump") pending.push({ ...base, kind: "jump" });
    else if (intent.type === "cancel-aura")
      pending.push({
        ...base,
        kind: "cancel-aura",
        abilityId: intent.abilityId,
      });
    else if (intent.type === "target")
      pending.push({ ...base, kind: "target", targetId: intent.targetId });
    else
      pending.push({
        ...base,
        kind: "ability",
        abilityId: intent.abilityId,
        ...(intent.targetId ? { targetId: intent.targetId } : {}),
        ...(intent.point ? { point: intent.point } : {}),
      });
  });
  socket.on("close", () => {
    const roomId = clientRooms.get(socket);
    const leaving = clients.get(socket);
    clients.delete(socket);
    clientRooms.delete(socket);
    if (practice.delete(socket)) return;
    if (roomId) {
      const room = rooms.get(roomId);
      const players = [...clients.entries()]
        .filter(([ws]) => clientRooms.get(ws) === roomId)
        .map(([, p]) => p);
      if (roomId === PLAYGROUND_ID && room && leaving) {
        room.commands = [];
        room.state = removePlaygroundPlayer(room.state, leaving.id);
      } else if (room && (roomId === "public" || players.length)) {
        room.commands = [];
        room.state = createMatch([...players, ...room.bots], 2026);
      } else if (roomId !== "public") rooms.delete(roomId);
    }
    broadcast();
  });
});

setInterval(() => {
  for (const room of practice.values()) {
    room.state = advanceTick(room.state, [
      ...room.commands,
      ...botCommands(room.state, room.bots),
    ]).state;
    room.commands = [];
  }
  for (const [roomId, room] of rooms) {
    if (room.state.phase !== "running") continue;
    const next = advanceTick(room.state, [
      ...room.commands,
      ...botCommands(
        room.state,
        room.bots.map((bot) => bot.id),
      ),
    ]).state;
    room.state = roomId === PLAYGROUND_ID ? keepPlaygroundRunning(next) : next;
    room.commands = [];
  }
  broadcast();
}, TICK_DURATION_MS);

function broadcast() {
  for (const [socket, player] of clients) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    if (socket.bufferedAmount > 256_000) continue;
    const visible =
      practice.get(socket)?.state ??
      rooms.get(clientRooms.get(socket) ?? "public")?.state;
    if (!visible) continue;
    const viewer = visible.players[player.id];
    const visiblePlayers = Object.fromEntries(
      Object.entries(visible.players).filter(
        ([, p]) =>
          visible.phase === "waiting" ||
          (!!viewer && canObservePlayer(viewer, p, visible.tick, 160)),
      ),
    );
    const snapshot: ServerSnapshot<MatchState> = {
      kind: "server.snapshot",
      protocolVersion: PROTOCOL_VERSION,
      acknowledgedSequence: visible.players[player.id]?.lastSequence ?? -1,
      state: { ...visible, players: visiblePlayers },
    };
    socket.send(JSON.stringify(snapshot));
  }
}

await server.listen({ port, host });
