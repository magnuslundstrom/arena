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
  createMatch,
  TICK_DURATION_MS,
  type MatchPlayer,
  type MatchState,
  type SimulationCommand,
} from "@arena/simulation";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const server = Fastify({ logger: true });
const sockets = new WebSocketServer({ noServer: true });
const clients = new Map<WebSocket, MatchPlayer>();
let commands: SimulationCommand[] = [];
let state = createMatch([], 2026);

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
      if (clients.size >= 4) return socket.close(1013, "Arena is full");
      const player: MatchPlayer = {
        id: randomUUID(),
        name: message.name,
        specId: message.specId,
        team: clients.size < 2 ? 0 : 1,
      };
      clients.set(socket, player);
      state = createMatch([...clients.values()], 2026);
      const welcome: ServerWelcome = {
        kind: "server.welcome",
        protocolVersion: PROTOCOL_VERSION,
        playerId: player.id,
        team: player.team,
      };
      socket.send(JSON.stringify(welcome));
      broadcast();
      return;
    }
    if (!Value.Check(PlayerIntentSchema, message)) return;
    const base = {
      playerId: joined.id,
      sequence: message.sequence,
      targetTick: state.tick + 1,
    };
    const intent = message.intent;
    if (intent.type === "move")
      commands.push({ ...base, kind: "move", x: intent.x, y: intent.y });
    else if (intent.type === "target")
      commands.push({ ...base, kind: "target", targetId: intent.targetId });
    else
      commands.push({
        ...base,
        kind: "ability",
        abilityId: intent.abilityId,
        ...(intent.targetId ? { targetId: intent.targetId } : {}),
        ...(intent.point ? { point: intent.point } : {}),
      });
  });
  socket.on("close", () => {
    clients.delete(socket);
    commands = [];
    state = createMatch([...clients.values()], 2026);
    broadcast();
  });
});

setInterval(() => {
  if (clients.size === 4 && state.phase !== "finished") {
    state = advanceTick(state, commands).state;
    commands = [];
  }
  if (state.tick % 2 === 0) broadcast();
}, TICK_DURATION_MS);

function broadcast() {
  for (const [socket, player] of clients) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    const snapshot: ServerSnapshot<MatchState> = {
      kind: "server.snapshot",
      protocolVersion: PROTOCOL_VERSION,
      acknowledgedSequence: state.players[player.id]?.lastSequence ?? -1,
      state,
    };
    socket.send(JSON.stringify(snapshot));
  }
}

await server.listen({ port, host });
