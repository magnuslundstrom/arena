import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { render } from "solid-js/web";
import { SPECS, type SpecId } from "@arena/game-content";
import {
  PROTOCOL_VERSION,
  type ServerSnapshot,
  type ServerWelcome,
} from "@arena/protocol";
import { type MatchState, type PlayerState } from "@arena/simulation";
import "./styles.css";
import { mountArena, cameraHeading } from "./arena3d";

const ABILITY_BINDS = [
  "1",
  "2",
  "3",
  "4",
  "q",
  "e",
  "r",
  "t",
  "s",
  "f",
  "g",
  "z",
  "x",
  "c",
] as const;

function App() {
  const [specId, setSpecId] = createSignal<SpecId>("frost-mage");
  const [name, setName] = createSignal(
    `Player ${Math.floor(Math.random() * 90 + 10)}`,
  );
  const [socket, setSocket] = createSignal<WebSocket>();
  const [playerId, setPlayerId] = createSignal<string>();
  const [team, setTeam] = createSignal<number>();
  const [state, setState] = createSignal<MatchState>();
  const [connection, setConnection] = createSignal("Offline");
  let sequence = 0;
  let lastIceBlockTap = 0;
  const held = new Set<string>();
  const self = createMemo(() => state()?.players[playerId() ?? ""]);
  const abilities = createMemo(() =>
    self() ? SPECS[self()!.specId].abilities : SPECS[specId()].abilities,
  );

  function connect(practice = false) {
    sequence = 0;
    setState(undefined);
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${location.host}/connect`);
    setConnection("Connecting");
    setSocket(ws);
    ws.addEventListener("open", () => {
      setConnection("Waiting for players");
      ws.send(
        JSON.stringify({
          kind: "client.hello",
          protocolVersion: PROTOCOL_VERSION,
          name: name().trim() || "Player",
          specId: specId(),
          practice,
        }),
      );
    });
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data)) as
        ServerWelcome | ServerSnapshot<MatchState>;
      if (message.kind === "server.welcome") {
        setPlayerId(message.playerId);
        setTeam(message.team);
      } else {
        setState((previous) => ({
          ...message.state,
          events: [
            ...(previous?.events ?? []),
            ...(previous?.tick === message.state.tick
              ? []
              : message.state.events),
          ].slice(-40),
        }));
        setConnection(
          message.state.phase === "waiting"
            ? `Waiting ${Object.keys(message.state.players).length}/4`
            : "Live",
        );
      }
    });
    ws.addEventListener("close", (event) => {
      setSocket(undefined);
      setConnection(event.reason || "Disconnected");
    });
  }

  function send(intent: object) {
    const ws = socket();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        kind: "player.intent",
        protocolVersion: PROTOCOL_VERSION,
        sequence: sequence++,
        clientTick: state()?.tick ?? 0,
        intent,
      }),
    );
  }

  function useAbility(abilityId: string) {
    const me = self();
    if (!me) return;
    const ability = SPECS[me.specId].abilities.find(
      (entry) => entry.id === abilityId,
    );
    if (!ability) return;
    const targetId =
      ability.target === "self" || ability.target === "point"
        ? undefined
        : ability.target === "ally" &&
            (!me.targetId || state()?.players[me.targetId]?.team !== me.team)
          ? me.id
          : me.targetId;
    const point =
      ability.target === "point"
        ? {
            x: me.x - Math.sin(cameraHeading.yaw) * 600,
            y: me.y - Math.cos(cameraHeading.yaw) * 600,
          }
        : undefined;
    send({
      type: "ability",
      abilityId,
      ...(targetId ? { targetId } : {}),
      ...(point ? { point } : {}),
    });
  }

  onMount(() => {
    const keydown = (event: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((event.target as HTMLElement).tagName))
        return;
      const key = event.key.toLowerCase();
      if (["w", "a", "d", "arrowdown"].includes(key)) held.add(key);
      if (event.key === "Tab") {
        event.preventDefault();
        const me = self();
        const enemies = Object.values(state()?.players ?? {}).filter(
          (p) => p.team !== me?.team && p.health > 0,
        );
        const current = enemies.findIndex((p) => p.id === me?.targetId);
        const next = enemies[(current + 1) % enemies.length];
        if (next) send({ type: "target", targetId: next.id });
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) send({ type: "jump" });
      }
      if (event.repeat) return;
      const index = ABILITY_BINDS.indexOf(
        key as (typeof ABILITY_BINDS)[number],
      );
      if (index >= 0 && index < abilities().length) {
        event.preventDefault();
        const ability = abilities()[index];
        if (ability?.id === "ice-block") {
          const now = performance.now();
          if (now - lastIceBlockTap <= 450) {
            send({ type: "cancel-aura", abilityId: "ice-block" });
            lastIceBlockTap = 0;
            return;
          }
          lastIceBlockTap = now;
        }
        if (ability) useAbility(ability.id);
      }
    };
    const keyup = (event: KeyboardEvent) =>
      held.delete(event.key.toLowerCase());
    window.addEventListener("keydown", keydown);
    const blur = () => held.clear();
    window.addEventListener("blur", blur);
    window.addEventListener("keyup", keyup);
    const movement = window.setInterval(() => {
      if (!self() || state()?.phase !== "running") return;
      const x = (held.has("d") ? 1 : 0) - (held.has("a") ? 1 : 0);
      const y = (held.has("arrowdown") ? 1 : 0) - (held.has("w") ? 1 : 0);
      if (x || y) {
        const yaw = cameraHeading.yaw;
        send({
          type: "move",
          x: Math.cos(yaw) * x + Math.sin(yaw) * y,
          y: -Math.sin(yaw) * x + Math.cos(yaw) * y,
        });
      }
    }, 33);
    onCleanup(() => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keyup", keyup);
      clearInterval(movement);
      socket()?.close();
    });
  });

  return (
    <div class="app">
      <header>
        <strong>ARENA</strong>
        <span>{connection()}</span>
        <span class="team">
          Team {team() === undefined ? "—" : team()! + 1}
        </span>
        <Show when={socket()}>
          <button onClick={() => socket()?.close()}>Leave match</button>
        </Show>
      </header>
      <Show
        when={socket()}
        fallback={
          <Lobby
            name={name()}
            specId={specId()}
            onName={setName}
            onSpec={setSpecId}
            onConnect={connect}
          />
        }
      >
        <Game
          state={state()}
          selfId={playerId()}
          onTarget={(targetId) => send({ type: "target", targetId })}
        />
        <Show when={self()}>
          {(me) => (
            <ActionBar
              player={me()}
              abilities={abilities()}
              tick={state()?.tick ?? 0}
              onUse={useAbility}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}

function Lobby(props: {
  name: string;
  specId: SpecId;
  onName: (value: string) => void;
  onSpec: (value: SpecId) => void;
  onConnect: (practice: boolean) => void;
}) {
  return (
    <main class="lobby">
      <p class="eyebrow">REAL-TIME 2V2</p>
      <h1>Enter the arena.</h1>
      <p>
        Choose a spec and practice with bots, or join a four-player match. W/A/D
        moves, click selects, and the action bar shows every combat bind.
      </p>
      <label>
        Combatant name
        <input
          value={props.name}
          maxlength="18"
          onInput={(e) => props.onName(e.currentTarget.value)}
        />
      </label>
      <div class="specs">
        <For each={Object.values(SPECS)}>
          {(spec) => (
            <button
              classList={{ selected: props.specId === spec.id }}
              style={{ "--spec": spec.color }}
              onClick={() => props.onSpec(spec.id)}
            >
              <b>{spec.name}</b>
              <small>{spec.abilities.length} abilities</small>
            </button>
          )}
        </For>
      </div>
      <button class="join" onClick={() => props.onConnect(true)}>
        Practice with bots
      </button>{" "}
      <button class="join" onClick={() => props.onConnect(false)}>
        Join match
      </button>
    </main>
  );
}

function Game(props: {
  state: MatchState | undefined;
  selfId: string | undefined;
  onTarget: (id: string) => void;
}) {
  let canvas!: HTMLCanvasElement;
  const player = () => props.state?.players[props.selfId ?? ""];
  const target = () => props.state?.players[player()?.targetId ?? ""];
  const friendlies = () =>
    Object.values(props.state?.players ?? {}).filter(
      (candidate) =>
        candidate.id !== props.selfId && candidate.team === player()?.team,
    );
  const enemies = () =>
    Object.values(props.state?.players ?? {}).filter(
      (candidate) => candidate.team !== player()?.team,
    );
  onMount(() => {
    onCleanup(
      mountArena(
        canvas,
        () => props.state,
        () => props.selfId,
        props.onTarget,
      ),
    );
  });
  return (
    <main class="game">
      <div class="primary-frames">
        <Show when={player()}>
          {(current) => (
            <UnitFrame
              player={current()}
              tick={props.state?.tick ?? 0}
              label="Player"
              large
            />
          )}
        </Show>
        <Show when={target()}>
          {(current) => (
            <UnitFrame
              player={current()}
              tick={props.state?.tick ?? 0}
              label="Target"
              large
              targeted
              comboPoints={
                player()?.specId === "subtlety-rogue" &&
                player()?.comboTargetId === current().id
                  ? (player()?.comboPoints ?? 0)
                  : player()?.specId === "subtlety-rogue"
                    ? 0
                    : undefined
              }
              onSelect={props.onTarget}
            />
          )}
        </Show>
      </div>
      <div class="arena-frames friendly-frames">
        <div class="frame-heading">Party</div>
        <For each={friendlies()}>
          {(current) => (
            <UnitFrame
              player={current}
              tick={props.state?.tick ?? 0}
              targeted={player()?.targetId === current.id}
              onSelect={props.onTarget}
            />
          )}
        </For>
      </div>
      <div class="arena-frames enemy-frames">
        <div class="frame-heading">Enemies</div>
        <For each={enemies()}>
          {(current) => (
            <UnitFrame
              player={current}
              tick={props.state?.tick ?? 0}
              targeted={player()?.targetId === current.id}
              onSelect={props.onTarget}
            />
          )}
        </For>
      </div>
      <canvas
        ref={canvas}
        aria-label="Third-person arena: hold right mouse to orbit; wheel to zoom"
      />
      <div class="camera-help">
        W forward · A/D strafe · ↓ back · Space jump · Right-drag camera · Tab
        target
      </div>
      <Show when={props.state?.phase === "waiting"}>
        <div class="overlay">
          Waiting for four players
          <br />
          <small>
            {Object.keys(props.state?.players ?? {}).length}/4 joined
          </small>
        </div>
      </Show>
      <Show when={props.state?.phase === "finished"}>
        <div class="overlay">
          Team {(props.state?.winnerTeam ?? 0) + 1} wins
        </div>
      </Show>
      <CombatLog events={props.state?.events ?? []} />
    </main>
  );
}

function UnitFrame(props: {
  player: PlayerState;
  tick: number;
  label?: string;
  large?: boolean;
  targeted?: boolean;
  comboPoints?: number | undefined;
  onSelect?: (id: string) => void;
}) {
  const spec = () => SPECS[props.player.specId];
  const activeStatuses = () =>
    Object.entries(props.player.statuses).filter(
      ([, until]) => (until ?? 0) > props.tick,
    );
  const content = () => (
    <>
      <Show when={props.label}>
        <small class="frame-label">{props.label}</small>
      </Show>
      <div class="frame-name">
        <b>{props.player.name}</b>
        <span>{spec().name}</span>
      </div>
      <div class="frame-resource health">
        <i
          style={{
            width: `${(props.player.health / spec().maxHealth) * 100}%`,
          }}
        />
        <span>
          {props.player.health} / {spec().maxHealth}
        </span>
      </div>
      <div class="frame-resource power">
        <i
          style={{ width: `${(props.player.mana / spec().maxMana) * 100}%` }}
        />
        <span>{props.player.mana}</span>
      </div>
      <Show when={props.comboPoints !== undefined}>
        <div
          class="combo-points"
          aria-label={`${props.comboPoints ?? 0} combo points`}
        >
          <For each={[0, 1, 2, 3, 4]}>
            {(point) => (
              <i classList={{ active: point < (props.comboPoints ?? 0) }} />
            )}
          </For>
        </div>
      </Show>
      <div class="frame-effects">
        <Show when={props.player.shield > 0}>
          <em>Shield {props.player.shield}</em>
        </Show>
        <For each={activeStatuses()}>
          {([status, until]) => (
            <em>
              {status === "incapacitate" ? "Gouge" : status}{" "}
              {(((until ?? 0) - props.tick) / 30).toFixed(1)}
            </em>
          )}
        </For>
      </div>
      <Show when={props.player.cast}>
        {(cast) => (
          <div class="frame-cast">
            <i
              style={{
                width: `${Math.max(0, 100 - ((cast().completesAtTick - props.tick) / (spec().abilities.find((ability) => ability.id === cast().abilityId)?.castTicks ?? 1)) * 100)}%`,
              }}
            />
            <span>
              {
                spec().abilities.find(
                  (ability) => ability.id === cast().abilityId,
                )?.name
              }
            </span>
          </div>
        )}
      </Show>
    </>
  );
  return props.onSelect ? (
    <button
      class="unit-frame"
      classList={{
        large: props.large,
        targeted: props.targeted,
        dead: props.player.health <= 0,
      }}
      onClick={() => props.onSelect?.(props.player.id)}
    >
      {content()}
    </button>
  ) : (
    <div
      class="unit-frame"
      classList={{ large: props.large, dead: props.player.health <= 0 }}
    >
      {content()}
    </div>
  );
}

function ActionBar(props: {
  player: PlayerState;
  abilities: readonly {
    id: string;
    name: string;
    cooldownTicks: number;
    manaCost: number;
  }[];
  tick: number;
  onUse: (id: string) => void;
}) {
  return (
    <footer>
      <div class="self-bars">
        <b>
          {props.player.name} · {SPECS[props.player.specId].name}
        </b>
        <meter
          min="0"
          max={SPECS[props.player.specId].maxHealth}
          value={props.player.health}
        />
        <meter
          class="mana"
          min="0"
          max={SPECS[props.player.specId].maxMana}
          value={props.player.mana}
        />
      </div>
      <div class="actions">
        <For each={props.abilities}>
          {(ability, index) => {
            const remaining = () =>
              Math.max(
                0,
                (props.player.cooldowns[ability.id] ?? 0) - props.tick,
              );
            return (
              <button
                disabled={
                  remaining() > 0 || props.player.mana < ability.manaCost
                }
                onClick={() => props.onUse(ability.id)}
              >
                <kbd>{ABILITY_BINDS[index()]?.toUpperCase() ?? "—"}</kbd>
                <span>{ability.name}</span>
                <Show when={remaining() > 0}>
                  <em>{(remaining() / 30).toFixed(1)}</em>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </footer>
  );
}
function CombatLog(props: {
  events: readonly { tick: number; text: string }[];
}) {
  return (
    <aside class="log">
      <For each={props.events.slice(-5).reverse()}>
        {(event) => (
          <div>
            <small>{event.tick}</small> {event.text}
          </div>
        )}
      </For>
    </aside>
  );
}

render(() => <App />, document.getElementById("root")!);
