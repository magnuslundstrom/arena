import { type Static, Type } from "@sinclair/typebox";

export const PROTOCOL_VERSION = 1 as const;

export const ClientHelloSchema = Type.Object(
  {
    kind: Type.Literal("client.hello"),
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    matchTicket: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ClientHello = Static<typeof ClientHelloSchema>;

export const PlayerIntentSchema = Type.Object(
  {
    kind: Type.Literal("player.intent"),
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    matchId: Type.String({ minLength: 1 }),
    sequence: Type.Integer({ minimum: 0 }),
    clientTick: Type.Integer({ minimum: 0 }),
    intent: Type.Union([
      Type.Object({ type: Type.Literal("stop") }),
      Type.Object({
        type: Type.Literal("move"),
        x: Type.Integer({ minimum: -1, maximum: 1 }),
        y: Type.Integer({ minimum: -1, maximum: 1 }),
      }),
    ]),
  },
  { additionalProperties: false },
);

export type PlayerIntent = Static<typeof PlayerIntentSchema>;

export const ServerWelcomeSchema = Type.Object(
  {
    kind: Type.Literal("server.welcome"),
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    connectionId: Type.String(),
    serverTick: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type ServerWelcome = Static<typeof ServerWelcomeSchema>;

export const ClientMessageSchema = Type.Union([
  ClientHelloSchema,
  PlayerIntentSchema,
]);

export type ClientMessage = Static<typeof ClientMessageSchema>;
