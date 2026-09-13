import { type Static, Type } from "@sinclair/typebox";

export const PROTOCOL_VERSION = 2 as const;
export const SpecIdSchema = Type.Union([
  Type.Literal("frost-mage"),
  Type.Literal("subtlety-rogue"),
  Type.Literal("discipline-priest"),
]);
export const ClientHelloSchema = Type.Object(
  {
    kind: Type.Literal("client.hello"),
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    name: Type.String({ minLength: 1, maxLength: 18 }),
    specId: SpecIdSchema,
    practice: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const PlayerIntentSchema = Type.Object(
  {
    kind: Type.Literal("player.intent"),
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    sequence: Type.Integer({ minimum: 0 }),
    clientTick: Type.Integer({ minimum: 0 }),
    intent: Type.Union([
      Type.Object({
        type: Type.Literal("move"),
        x: Type.Number({ minimum: -2, maximum: 2 }),
        y: Type.Number({ minimum: -2, maximum: 2 }),
      }),
      Type.Object({ type: Type.Literal("target"), targetId: Type.String() }),
      Type.Object({
        type: Type.Literal("ability"),
        abilityId: Type.String(),
        targetId: Type.Optional(Type.String()),
        point: Type.Optional(
          Type.Object({ x: Type.Number(), y: Type.Number() }),
        ),
      }),
    ]),
  },
  { additionalProperties: false },
);
export const ClientMessageSchema = Type.Union([
  ClientHelloSchema,
  PlayerIntentSchema,
]);
export const ServerWelcomeSchema = Type.Object({
  kind: Type.Literal("server.welcome"),
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  playerId: Type.String(),
  team: Type.Integer({ minimum: 0, maximum: 1 }),
});
export type ClientHello = Static<typeof ClientHelloSchema>;
export type PlayerIntent = Static<typeof PlayerIntentSchema>;
export type ClientMessage = Static<typeof ClientMessageSchema>;
export type ServerWelcome = Static<typeof ServerWelcomeSchema>;

export interface ServerSnapshot<TState = unknown> {
  readonly kind: "server.snapshot";
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly acknowledgedSequence: number;
  readonly state: TState;
}
