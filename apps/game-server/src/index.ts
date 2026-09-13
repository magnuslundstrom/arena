import { randomUUID } from "node:crypto";

import { Value } from "@sinclair/typebox/value";
import Fastify from "fastify";
import { WebSocketServer } from "ws";

import {
  ClientHelloSchema,
  PROTOCOL_VERSION,
  type ServerWelcome,
} from "@arena/protocol";
import { createSimulation } from "@arena/simulation";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const server = Fastify({ logger: true });
const sockets = new WebSocketServer({ noServer: true });

server.get("/health", async () => ({ status: "ok" }));

server.server.on("upgrade", (request, socket, head) => {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  if (url.pathname !== "/connect") {
    socket.destroy();
    return;
  }

  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    sockets.emit("connection", webSocket, request);
  });
});

sockets.on("connection", (socket) => {
  const simulation = createSimulation(0);

  socket.once("message", (raw) => {
    let message: unknown;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      socket.close(1007, "Invalid JSON");
      return;
    }

    if (!Value.Check(ClientHelloSchema, message)) {
      socket.close(1008, "Expected a valid client hello");
      return;
    }

    // Match-ticket verification will replace this bootstrap acceptance path.
    const welcome: ServerWelcome = {
      kind: "server.welcome",
      protocolVersion: PROTOCOL_VERSION,
      connectionId: randomUUID(),
      serverTick: simulation.tick,
    };
    socket.send(JSON.stringify(welcome));
  });
});

await server.listen({ port, host });
