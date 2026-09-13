import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import Fastify from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import {
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
let commands: SimulationCommand[] = [];
let state = createMatch([], 2026);
const practice = new Map<
  WebSocket,
  { state: MatchState; commands: SimulationCommand[]; bots: string[] }
>();

server.get("/health", async () => ({
  status: "ok",
  players: clients.size,
  tick: state.tick,
}));
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
      const publicPlayers = [...clients.entries()]
        .filter(([ws]) => !practice.has(ws))
        .map(([, p]) => p);
      if (!message.practice && publicPlayers.length >= 4)
        return socket.close(1013, "Arena is full");
      const player: MatchPlayer = {
        id: randomUUID(),
        name: message.name,
        specId: message.specId,
        team: publicPlayers.filter((p) => p.team === 0).length < 2 ? 0 : 1,
      };
      clients.set(socket, player);
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
          { id: "bot-mage", name: "Enemy Mage", team: 1, specId: "frost-mage" },
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
      } else
        state = createMatch(
          [...clients.entries()]
            .filter(([ws]) => !practice.has(ws))
            .map(([, p]) => p),
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
    if (!Value.Check(PlayerIntentSchema, message)) return;
    const room = practice.get(socket);
    const pending = room?.commands ?? commands;
    if (pending.filter((c) => c.playerId === joined.id).length >= 4) return;
    const base = {
      playerId: joined.id,
      sequence: message.sequence,
      targetTick: (room?.state.tick ?? state.tick) + 1,
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
    clients.delete(socket);
    if (practice.delete(socket)) return;
    commands = [];
    state = createMatch(
      [...clients.entries()]
        .filter(([ws]) => !practice.has(ws))
        .map(([, p]) => p),
      2026,
    );
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
  if (state.phase === "running") {
    state = advanceTick(state, commands).state;
    commands = [];
  }
  broadcast();
}, TICK_DURATION_MS);

function broadcast() {
  for (const [socket, player] of clients) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    if (socket.bufferedAmount > 256_000) continue;
    const visible = practice.get(socket)?.state ?? state;
    const viewer = visible.players[player.id];
    const visiblePlayers = Object.fromEntries(
      Object.entries(visible.players).filter(
        ([, p]) => !!viewer && canObservePlayer(viewer, p, visible.tick, 160),
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
