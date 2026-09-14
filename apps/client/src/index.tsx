import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { render } from "solid-js/web";
import {
  SPECS,
  UNITS_PER_YARD,
  type AbilityDefinition,
  type SpecId,
} from "@arena/game-content";
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

const abilityOrderKey = (specId: SpecId) => `arena.ability-order.${specId}`;
const MATCH_HISTORY_KEY = "arena.match-history";

interface MatchHistoryEntry {
  readonly id: string;
  readonly finishedAt: number;
  readonly durationSeconds: number;
  readonly specId: SpecId;
  readonly won: boolean;
  readonly practice: boolean;
  readonly damageDone: number;
  readonly healingDone: number;
  readonly killingBlows: number;
}

function loadMatchHistory(): MatchHistoryEntry[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(MATCH_HISTORY_KEY) ?? "[]",
    );
    return Array.isArray(saved) ? saved.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function loadAbilityOrder(specId: SpecId) {
  const defaultOrder = SPECS[specId].abilities.map((ability) => ability.id);
  try {
    const saved = JSON.parse(
      localStorage.getItem(abilityOrderKey(specId)) ?? "[]",
    );
    if (!Array.isArray(saved)) return defaultOrder;
    const known = new Set(defaultOrder);
    const valid = saved.filter(
      (id): id is string => typeof id === "string" && known.delete(id),
    );
    return [...valid, ...defaultOrder.filter((id) => known.has(id))];
  } catch {
    return defaultOrder;
  }
}

function loadAbilityOrders(): Record<SpecId, string[]> {
  return {
    "frost-mage": loadAbilityOrder("frost-mage"),
    "subtlety-rogue": loadAbilityOrder("subtlety-rogue"),
    "discipline-priest": loadAbilityOrder("discipline-priest"),
  };
}

function App() {
  const [specId, setSpecId] = createSignal<SpecId>("frost-mage");
  const [name, setName] = createSignal(
    `Player ${Math.floor(Math.random() * 90 + 10)}`,
  );
  const [socket, setSocket] = createSignal<WebSocket>();
  const [playerId, setPlayerId] = createSignal<string>();
  const [state, setState] = createSignal<MatchState>();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [abilityOrders, setAbilityOrders] = createSignal(loadAbilityOrders());
  const [matchHistory, setMatchHistory] = createSignal(loadMatchHistory());
  const [currentWorld, setCurrentWorld] = createSignal<
    "arena" | "practice" | "playground"
  >("arena");
  const [page, setPage] = createSignal<"lobby" | "history">(
    location.hash === "#history" ? "history" : "lobby",
  );
  const [lobbyStep, setLobbyStep] = createSignal<"name" | "class">("name");
  const [roomId, setRoomId] = createSignal(
    new URLSearchParams(location.search).get("room") ?? undefined,
  );
  let sequence = 0;
  let lastIceBlockTap = 0;
  let currentMatchIsPractice = false;
  let currentMatchSaved = false;
  const held = new Set<string>();
  const self = createMemo(() => state()?.players[playerId() ?? ""]);
  const abilities = createMemo(() => {
    const currentSpec = self()?.specId ?? specId();
    const definitions = SPECS[currentSpec].abilities;
    const byId = new Map(definitions.map((ability) => [ability.id, ability]));
    return abilityOrders()
      [currentSpec].map((id) => byId.get(id))
      .filter((ability): ability is AbilityDefinition => !!ability);
  });

  onMount(() => {
    const updatePage = () =>
      setPage(location.hash === "#history" ? "history" : "lobby");
    window.addEventListener("hashchange", updatePage);
    onCleanup(() => window.removeEventListener("hashchange", updatePage));
  });

  createEffect(() => {
    const finished = state();
    const id = playerId();
    if (finished?.phase !== "finished" || !id || currentMatchSaved) return;
    const player = finished.players[id];
    if (!player) return;
    currentMatchSaved = true;
    const stats = finished.stats[id];
    const entry: MatchHistoryEntry = {
      id: crypto.randomUUID(),
      finishedAt: Date.now(),
      durationSeconds: Math.floor(finished.tick / 30),
      specId: player.specId,
      won: player.team === finished.winnerTeam,
      practice: currentMatchIsPractice,
      damageDone: stats?.damageDone ?? 0,
      healingDone: stats?.healingDone ?? 0,
      killingBlows: stats?.killingBlows ?? 0,
    };
    setMatchHistory((previous) => {
      const next = [entry, ...previous].slice(0, 20);
      try {
        localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Keep the history available in memory for this visit.
      }
      return next;
    });
  });

  function saveAbilityOrder(currentSpec: SpecId, order: readonly string[]) {
    const known = new Set(SPECS[currentSpec].abilities.map(({ id }) => id));
    const normalized = order.filter((id) => known.delete(id));
    normalized.push(...known);
    setAbilityOrders((orders) => ({ ...orders, [currentSpec]: normalized }));
    try {
      localStorage.setItem(
        abilityOrderKey(currentSpec),
        JSON.stringify(normalized),
      );
    } catch {
      // The layout still works for this session when storage is unavailable.
    }
  }

  function connect(practice = false, requestedRoomId?: string) {
    sequence = 0;
    setCurrentWorld(
      practice
        ? "practice"
        : requestedRoomId === "playground"
          ? "playground"
          : "arena",
    );
    currentMatchIsPractice = practice;
    currentMatchSaved = false;
    setState(undefined);
    setMenuOpen(false);
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${location.host}/connect`);
    setSocket(ws);
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          kind: "client.hello",
          protocolVersion: PROTOCOL_VERSION,
          name: name().trim() || "Player",
          specId: specId(),
          practice,
          ...(requestedRoomId ? { roomId: requestedRoomId } : {}),
        }),
      );
    });
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data)) as
        ServerWelcome | ServerSnapshot<MatchState>;
      if (message.kind === "server.welcome") {
        setPlayerId(message.playerId);
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
      }
    });
    ws.addEventListener("close", () => {
      setSocket(undefined);
      setMenuOpen(false);
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

  function selectTeam(selectedTeam: number) {
    const ws = socket();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        kind: "client.team",
        protocolVersion: PROTOCOL_VERSION,
        team: selectedTeam,
      }),
    );
  }

  function addBot(team: number, botSpecId: SpecId) {
    const ws = socket();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        kind: "client.add-bot",
        protocolVersion: PROTOCOL_VERSION,
        team,
        specId: botSpecId,
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
      ability.target === "self" ||
      ability.target === "point" ||
      ability.target === "enemy-area" ||
      ability.target === "enemy-cone"
        ? undefined
        : ability.target === "any"
          ? (me.targetId ?? me.id)
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
      if (event.key === "Escape" && socket() && state()?.phase !== "waiting") {
        event.preventDefault();
        held.clear();
        setMenuOpen((open) => !open);
        return;
      }
      if (menuOpen()) return;
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
      if (!self() || state()?.phase !== "running" || menuOpen()) return;
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
      <Show
        when={socket()}
        fallback={
          <Show
            when={page() === "history"}
            fallback={
              <Lobby
                name={name()}
                specId={specId()}
                step={lobbyStep()}
                roomId={roomId()}
                matchHistoryCount={matchHistory().length}
                onName={setName}
                onSpec={setSpecId}
                onStep={setLobbyStep}
                onConnect={connect}
                onPlayground={() => connect(false, "playground")}
                onCreateRoom={() => {
                  const bytes = crypto.getRandomValues(new Uint8Array(4));
                  const code = Array.from(bytes, (byte) =>
                    byte.toString(16).padStart(2, "0"),
                  )
                    .join("")
                    .toUpperCase();
                  setRoomId(code);
                  history.replaceState(null, "", `?room=${code}`);
                  connect(false, code);
                }}
              />
            }
          >
            <MatchHistoryPage entries={matchHistory()} />
          </Show>
        }
      >
        <Show
          when={state()?.phase !== "waiting"}
          fallback={
            <QueueLobby
              name={name()}
              specId={specId()}
              roomId={roomId()}
              players={Object.values(state()?.players ?? {})}
              selfId={playerId()}
              onTeam={selectTeam}
              onAddBot={addBot}
              onLeave={() => socket()?.close()}
            />
          }
        >
          <Game
            state={state()}
            selfId={playerId()}
            playground={currentWorld() === "playground"}
            onTarget={(targetId) => send({ type: "target", targetId })}
            onLeave={() => socket()?.close()}
          />
          <Show when={self()}>
            {(me) => (
              <ActionBar
                player={me()}
                state={state()!}
                abilities={abilities()}
                tick={state()?.tick ?? 0}
                onUse={useAbility}
                onReorder={(order) => saveAbilityOrder(me().specId, order)}
              />
            )}
          </Show>
          <Show when={menuOpen()}>
            <div class="arena-menu-backdrop">
              <section
                class="arena-menu"
                role="dialog"
                aria-modal="true"
                aria-labelledby="arena-menu-title"
              >
                <small>ARENA PAUSED LOCALLY</small>
                <h2 id="arena-menu-title">Match menu</h2>
                <p>The match continues while this menu is open.</p>
                <div class="arena-controls" aria-label="Controls">
                  <h3>Controls</h3>
                  <dl>
                    <div>
                      <dt>
                        <kbd>W</kbd>
                      </dt>
                      <dd>Move forward</dd>
                    </div>
                    <div>
                      <dt>
                        <kbd>A</kbd> <kbd>D</kbd>
                      </dt>
                      <dd>Strafe</dd>
                    </div>
                    <div>
                      <dt>
                        <kbd>↓</kbd>
                      </dt>
                      <dd>Move back</dd>
                    </div>
                    <div>
                      <dt>
                        <kbd>Space</kbd>
                      </dt>
                      <dd>Jump</dd>
                    </div>
                    <div>
                      <dt>Right-drag</dt>
                      <dd>Move camera</dd>
                    </div>
                    <div>
                      <dt>
                        <kbd>Tab</kbd>
                      </dt>
                      <dd>Change target</dd>
                    </div>
                  </dl>
                </div>
                <button autofocus onClick={() => setMenuOpen(false)}>
                  RETURN TO ARENA
                </button>
                <button class="leave-arena" onClick={() => socket()?.close()}>
                  LEAVE ARENA
                </button>
                <span>Press Esc to return</span>
              </section>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

function Lobby(props: {
  name: string;
  specId: SpecId;
  step: "name" | "class";
  roomId: string | undefined;
  matchHistoryCount: number;
  onName: (value: string) => void;
  onSpec: (value: SpecId) => void;
  onStep: (value: "name" | "class") => void;
  onConnect: (practice: boolean, roomId?: string) => void;
  onPlayground: () => void;
  onCreateRoom: () => void;
}) {
  const [status, setStatus] = createSignal({
    onlinePlayers: 0,
    activeMatches: 0,
    playgroundPlayers: 0,
  });
  onMount(() => {
    const refresh = () =>
      fetch("/status")
        .then((response) => response.json())
        .then(setStatus)
        .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 5000);
    onCleanup(() => clearInterval(timer));
  });
  return (
    <main class="lobby-shell">
      <div class="lobby-brand">
        <span class="brand-mark">A</span>
        <b>ARENA</b>
        <small>REAL-TIME 2V2</small>
      </div>
      <div class="world-status">
        <span>
          <i class="status-dot" /> {status().onlinePlayers} online
        </span>
        <span>
          <i class="crossed-swords">⚔</i> {status().activeMatches} matches live
        </span>
        <a href="#history">
          Match history
          <Show when={props.matchHistoryCount > 0}>
            <b>{props.matchHistoryCount}</b>
          </Show>
        </a>
      </div>
      <Show
        when={props.step === "class"}
        fallback={
          <section class="name-gate">
            <p class="eyebrow">THE GATES ARE OPEN</p>
            <h1>
              Enter the
              <br />
              <em>arena.</em>
            </h1>
            <p class="lobby-copy">
              A competitive 2v2 battleground where timing, teamwork, and mastery
              decide who leaves victorious.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (props.name.trim()) props.onStep("class");
              }}
            >
              <label>
                CHOOSE YOUR NAME
                <input
                  autofocus
                  value={props.name}
                  maxlength="18"
                  placeholder="Enter combatant name"
                  onInput={(e) => props.onName(e.currentTarget.value)}
                />
              </label>
              <button class="join" disabled={!props.name.trim()} type="submit">
                CONTINUE <span>→</span>
              </button>
            </form>
          </section>
        }
      >
        <section class="class-select">
          <button class="back-button" onClick={() => props.onStep("name")}>
            ← &nbsp; BACK
          </button>
          <p class="eyebrow">CHOOSE YOUR PATH</p>
          <h1>Select your class</h1>
          <p class="lobby-copy">
            Every fighter has a role. Choose the one that fits your playstyle.
          </p>
          <Show when={props.roomId}>
            <div class="invite-banner">
              <span>✦</span>
              <div>
                <small>PRIVATE INVITE</small>
                <b>Lobby {props.roomId}</b>
              </div>
            </div>
          </Show>
          <div class="specs">
            <For each={Object.values(SPECS)}>
              {(spec) => (
                <button
                  classList={{ selected: props.specId === spec.id }}
                  style={{ "--spec": spec.color }}
                  onClick={() => props.onSpec(spec.id)}
                >
                  <span class={`spec-emblem ${spec.id}`}>
                    <i>
                      {spec.id === "frost-mage"
                        ? "✦"
                        : spec.id === "subtlety-rogue"
                          ? "◆"
                          : "✚"}
                    </i>
                  </span>
                  <small>
                    {spec.id === "frost-mage"
                      ? "RANGED CONTROL"
                      : spec.id === "subtlety-rogue"
                        ? "MELEE ASSASSIN"
                        : "HEALER · SUPPORT"}
                  </small>
                  <b>{spec.name}</b>
                  <p>
                    {spec.id === "frost-mage"
                      ? "Freeze the battlefield and shatter enemies with precise bursts of frost."
                      : spec.id === "subtlety-rogue"
                        ? "Strike from the shadows and dismantle enemies before they can react."
                        : "Protect your ally and turn pressure into an unstoppable counterattack."}
                  </p>
                  <span class="select-label">
                    {props.specId === spec.id ? "SELECTED" : "SELECT CLASS"}
                  </span>
                </button>
              )}
            </For>
          </div>
          <div class="lobby-actions">
            <button
              class="join queue-button"
              onClick={() => props.onConnect(false, props.roomId)}
            >
              {props.roomId ? "JOIN PRIVATE LOBBY" : "ENTER QUEUE"}{" "}
              <span>→</span>
            </button>
            <Show when={!props.roomId}>
              <button class="create-lobby" onClick={props.onCreateRoom}>
                CREATE PRIVATE LOBBY
              </button>
            </Show>
            <button class="playground-button" onClick={props.onPlayground}>
              ENTER PLAYGROUND
              <Show when={status().playgroundPlayers > 0}>
                <small>{status().playgroundPlayers} inside</small>
              </Show>
            </button>
          </div>
        </section>
      </Show>
      <div class="test-menu">
        <span>TEST MODE</span>
        <button
          title="Start a match with bots"
          onClick={() => props.onConnect(true)}
        >
          BOT
          <br />
          MATCH
        </button>
      </div>
    </main>
  );
}

function MatchHistoryPage(props: { entries: readonly MatchHistoryEntry[] }) {
  const number = new Intl.NumberFormat();
  const duration = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <main class="history-page">
      <div class="lobby-brand">
        <span class="brand-mark">A</span>
        <b>ARENA</b>
        <small>REAL-TIME 2V2</small>
      </div>
      <section class="history-panel" aria-labelledby="match-history-title">
        <a class="back-button history-back" href="#">
          ← &nbsp; BACK TO LOBBY
        </a>
        <p class="eyebrow">YOUR RECORD</p>
        <h1 id="match-history-title">Match history</h1>
        <p>Saved locally on this device · Last 20 matches</p>
        <Show
          when={props.entries.length > 0}
          fallback={<div class="empty-history">No completed matches yet.</div>}
        >
          <div class="history-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Class</th>
                  <th>Mode</th>
                  <th>Duration</th>
                  <th>Damage</th>
                  <th>Healing</th>
                  <th>Kills</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                <For each={props.entries}>
                  {(match) => (
                    <tr classList={{ victory: match.won }}>
                      <td class="history-result">
                        {match.won ? "Victory" : "Defeat"}
                      </td>
                      <td>{SPECS[match.specId].name}</td>
                      <td>{match.practice ? "Practice" : "Arena"}</td>
                      <td>{duration(match.durationSeconds)}</td>
                      <td>{number.format(match.damageDone)}</td>
                      <td>{number.format(match.healingDone)}</td>
                      <td>{match.killingBlows}</td>
                      <td>
                        <time
                          datetime={new Date(match.finishedAt).toISOString()}
                        >
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(match.finishedAt)}
                        </time>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </section>
    </main>
  );
}

function QueueLobby(props: {
  name: string;
  specId: SpecId;
  roomId: string | undefined;
  players: PlayerState[];
  selfId: string | undefined;
  onTeam: (team: number) => void;
  onAddBot: (team: number, specId: SpecId) => void;
  onLeave: () => void;
}) {
  const [seconds, setSeconds] = createSignal(0);
  const [copied, setCopied] = createSignal(false);
  const [botTeam, setBotTeam] = createSignal<number>();
  onMount(() => {
    const started = Date.now();
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    onCleanup(() => clearInterval(timer));
  });
  const teamPlayers = (team: number) =>
    props.players.filter((player) => player.team === team);
  const playerCount = () => props.players.length;
  const selfTeam = () =>
    props.players.find((player) => player.id === props.selfId)?.team;
  const time = () =>
    `${String(Math.floor(seconds() / 60)).padStart(2, "0")}:${String(seconds() % 60).padStart(2, "0")}`;
  return (
    <main class="queue-lobby">
      <div class="lobby-brand">
        <span class="brand-mark">A</span>
        <b>ARENA</b>
        <small>MATCHMAKING</small>
      </div>
      <section class="queue-panel">
        <div class="queue-rune">
          <span>⚔</span>
        </div>
        <p class="eyebrow">SEARCHING FOR WARRIORS</p>
        <h1>Forming your match</h1>
        <p class="lobby-copy">
          The arena is gathering worthy opponents. Prepare yourself.
        </p>
        <div class="queue-stats">
          <div>
            <small>QUEUE TIME</small>
            <strong>{time()}</strong>
          </div>
          <div>
            <small>LOBBY</small>
            <strong>
              {playerCount()}
              <span>/4</span>
            </strong>
          </div>
        </div>
        <div class="team-lobby">
          <For each={[0, 1]}>
            {(team) => (
              <section class={`lobby-team team-${team + 1}`}>
                <header>
                  <span>TEAM {team + 1}</span>
                  <small>{teamPlayers(team).length}/2</small>
                </header>
                <div class="team-slots">
                  <For each={[0, 1]}>
                    {(slot) => {
                      const player = () => teamPlayers(team)[slot];
                      return (
                        <Show
                          when={player()}
                          fallback={
                            <div class="empty-slot-actions">
                              <button
                                class="empty-team-slot"
                                disabled={selfTeam() === team}
                                onClick={() => props.onTeam(team)}
                              >
                                <span>+</span>
                                <small>
                                  {selfTeam() === team
                                    ? "WAITING FOR PLAYER"
                                    : `JOIN TEAM ${team + 1}`}
                                </small>
                              </button>
                              <Show when={props.roomId}>
                                <button
                                  class="add-bot-button"
                                  onClick={() => setBotTeam(team)}
                                >
                                  + ADD BOT
                                </button>
                              </Show>
                            </div>
                          }
                        >
                          {(member) => (
                            <div
                              class="team-player"
                              classList={{ self: member().id === props.selfId }}
                            >
                              <span>
                                {member().name.charAt(0).toUpperCase()}
                              </span>
                              <div>
                                <b>{member().name}</b>
                                <small>{SPECS[member().specId].name}</small>
                              </div>
                              <Show when={member().id === props.selfId}>
                                <em>YOU</em>
                              </Show>
                              <Show when={member().id.startsWith("bot-")}>
                                <em>BOT</em>
                              </Show>
                            </div>
                          )}
                        </Show>
                      );
                    }}
                  </For>
                </div>
              </section>
            )}
          </For>
        </div>
        <Show when={botTeam() !== undefined}>
          <div class="bot-picker-backdrop" onClick={() => setBotTeam()}>
            <section
              class="bot-picker"
              role="dialog"
              aria-modal="true"
              aria-labelledby="bot-picker-title"
              onClick={(event) => event.stopPropagation()}
            >
              <small>FILL TEAM {(botTeam() ?? 0) + 1}</small>
              <h2 id="bot-picker-title">Choose a bot class</h2>
              <div>
                <For each={Object.values(SPECS)}>
                  {(spec) => (
                    <button
                      style={{ "--spec": spec.color }}
                      onClick={() => {
                        props.onAddBot(botTeam()!, spec.id);
                        setBotTeam();
                      }}
                    >
                      <span>◆</span>
                      <b>{spec.name}</b>
                    </button>
                  )}
                </For>
              </div>
              <button class="bot-picker-cancel" onClick={() => setBotTeam()}>
                CANCEL
              </button>
            </section>
          </div>
        </Show>
        <Show when={props.roomId}>
          <div class="share-lobby">
            <div>
              <small>INVITE LINK · LOBBY {props.roomId}</small>
              <span>{`${location.origin}/?room=${props.roomId}`}</span>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `${location.origin}/?room=${props.roomId}`,
                );
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              }}
            >
              {copied() ? "COPIED" : "COPY LINK"}
            </button>
          </div>
        </Show>
        <div class="selected-loadout">
          <span style={{ color: SPECS[props.specId].color }}>◆</span>
          <div>
            <small>YOUR CLASS</small>
            <b>{SPECS[props.specId].name}</b>
          </div>
        </div>
        <button class="cancel-queue" onClick={props.onLeave}>
          CANCEL QUEUE
        </button>
      </section>
    </main>
  );
}

function Game(props: {
  state: MatchState | undefined;
  selfId: string | undefined;
  playground: boolean;
  onTarget: (id: string) => void;
  onLeave: () => void;
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
  const matchDuration = () => {
    const totalSeconds = Math.floor((props.state?.tick ?? 0) / 30);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };
  onMount(() => {
    onCleanup(
      mountArena(
        canvas,
        () => props.state,
        () => props.selfId,
        props.onTarget,
        props.playground,
      ),
    );
  });
  return (
    <main class="game">
      <Show when={props.playground}>
        <div class="playground-status">
          <i /> Shared playground
        </div>
      </Show>
      <div class="match-timer" aria-label={`Match duration ${matchDuration()}`}>
        <small>{props.playground ? "World Time" : "Match Time"}</small>
        <time>{matchDuration()}</time>
      </div>
      <div class="primary-frames">
        <Show when={player()}>
          {(current) => (
            <UnitFrame
              player={current()}
              tick={props.state?.tick ?? 0}
              label="Player"
              large
              targeted={player()?.targetId === current().id}
              onSelect={props.onTarget}
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
              showEffects
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
              showEffects
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
              showEffects
              onSelect={props.onTarget}
            />
          )}
        </For>
      </div>
      <canvas
        ref={canvas}
        aria-label="Third-person arena: hold right mouse to orbit; wheel to zoom"
      />
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
        <MatchResults
          state={props.state!}
          selfId={props.selfId}
          onLeave={props.onLeave}
        />
      </Show>
      <CombatLog events={props.state?.events ?? []} />
    </main>
  );
}

function MatchResults(props: {
  state: MatchState;
  selfId: string | undefined;
  onLeave: () => void;
}) {
  const players = () =>
    Object.values(props.state.players).sort(
      (a, b) => a.team - b.team || a.name.localeCompare(b.name),
    );
  const won = () =>
    props.state.players[props.selfId ?? ""]?.team === props.state.winnerTeam;
  const number = new Intl.NumberFormat();
  return (
    <div class="match-results-backdrop">
      <section
        class="match-results"
        role="dialog"
        aria-labelledby="results-title"
      >
        <small>MATCH COMPLETE</small>
        <h2 id="results-title">{won() ? "Victory" : "Defeat"}</h2>
        <p>Team {(props.state.winnerTeam ?? 0) + 1} wins</p>
        <div class="results-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th>Damage</th>
                <th>Healing</th>
                <th>Kills</th>
              </tr>
            </thead>
            <tbody>
              <For each={players()}>
                {(player) => {
                  const stats = () => props.state.stats[player.id];
                  return (
                    <tr classList={{ self: player.id === props.selfId }}>
                      <th scope="row">
                        <span
                          class="result-spec"
                          style={{ "--spec": SPECS[player.specId].color }}
                        />
                        {player.name}
                      </th>
                      <td>{player.team + 1}</td>
                      <td>{number.format(stats()?.damageDone ?? 0)}</td>
                      <td>{number.format(stats()?.healingDone ?? 0)}</td>
                      <td>{stats()?.killingBlows ?? 0}</td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
        <button autofocus onClick={props.onLeave}>
          LEAVE GAME
        </button>
      </section>
    </div>
  );
}

function UnitFrame(props: {
  player: PlayerState;
  tick: number;
  label?: string;
  large?: boolean;
  targeted?: boolean;
  comboPoints?: number | undefined;
  showEffects?: boolean;
  onSelect?: (id: string) => void;
}) {
  const spec = () => SPECS[props.player.specId];
  const beneficialStatuses = new Set([
    "immunity",
    "damage-reduction",
    "evasion",
    "cloak",
    "stealth",
  ]);
  const activeEffects = () => {
    const effects = Object.entries(props.player.statuses)
      .filter(([, until]) => (until ?? 0) > props.tick)
      .map(([status, until]) => {
        const application =
          props.player.statusAbilities?.[
            status as keyof typeof props.player.statuses
          ];
        return application
          ? {
              ...application,
              status,
              until: until ?? props.tick,
              beneficial: beneficialStatuses.has(status),
            }
          : undefined;
      })
      .filter((effect) => effect !== undefined);
    if (props.player.shield > 0 && props.player.shieldAbility)
      effects.unshift({
        ...props.player.shieldAbility,
        status: "shield",
        until: props.tick,
        beneficial: true,
      });
    if (props.player.periodicHealing)
      effects.push({
        abilityId: "renew",
        specId: "discipline-priest" as const,
        status: "periodic-healing",
        until:
          props.player.periodicHealing.nextTick +
          Math.max(0, props.player.periodicHealing.ticksLeft - 1) * 90,
        beneficial: true,
      });
    return effects;
  };
  const effectName = (specId: SpecId, abilityId: string) =>
    SPECS[specId].abilities.find((ability) => ability.id === abilityId)?.name ??
    abilityId;
  const content = () => (
    <>
      <Show when={props.label}>
        <small class="frame-label">{props.label}</small>
      </Show>
      <Show when={(props.player.combatUntilTick ?? 0) > props.tick}>
        <small class="combat-label">In combat</small>
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
      <div
        class="frame-resource power"
        classList={{ energy: props.player.specId === "subtlety-rogue" }}
      >
        <i
          style={{ width: `${(props.player.mana / spec().maxMana) * 100}%` }}
        />
        <span>
          {props.player.mana} / {spec().maxMana}
        </span>
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
      <Show when={props.showEffects}>
        <div class="frame-effect-rows">
          <For each={[true, false]}>
            {(beneficial) => (
              <div
                class="frame-effect-row"
                classList={{ buffs: beneficial, debuffs: !beneficial }}
                aria-label={beneficial ? "Buffs" : "Debuffs"}
              >
                <For
                  each={activeEffects().filter(
                    (effect) => effect.beneficial === beneficial,
                  )}
                >
                  {(effect) => (
                    <span
                      class="frame-effect-icon"
                      style={abilityIconStyle(effect.specId, effect.abilityId)}
                      aria-label={`${effectName(effect.specId, effect.abilityId)}${effect.status === "shield" ? `, ${props.player.shield} absorb` : `, ${Math.max(0, (effect.until - props.tick) / 30).toFixed(1)} seconds remaining`}`}
                    >
                      <Show when={effect.status !== "shield"}>
                        <small>
                          {Math.max(
                            0,
                            (effect.until - props.tick) / 30,
                          ).toFixed(0)}
                        </small>
                      </Show>
                      <span class="frame-effect-tooltip">
                        <b>{effectName(effect.specId, effect.abilityId)}</b>
                        <small>
                          {effect.status === "shield"
                            ? `${props.player.shield} damage absorption remaining`
                            : `${Math.max(0, (effect.until - props.tick) / 30).toFixed(1)} seconds remaining`}
                        </small>
                      </span>
                    </span>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
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
      type="button"
      class="unit-frame"
      aria-label={`Target ${props.player.name}`}
      aria-pressed={props.targeted}
      classList={{
        large: props.large,
        targeted: props.targeted,
        dead: props.player.health <= 0,
        "in-combat": (props.player.combatUntilTick ?? 0) > props.tick,
      }}
      onClick={() => props.onSelect?.(props.player.id)}
    >
      {content()}
    </button>
  ) : (
    <div
      class="unit-frame"
      classList={{
        large: props.large,
        dead: props.player.health <= 0,
        "in-combat": (props.player.combatUntilTick ?? 0) > props.tick,
      }}
    >
      {content()}
    </div>
  );
}

function abilityEffectText(ability: AbilityDefinition) {
  return ability.effects
    .map((effect) => {
      const duration = effect.durationTicks
        ? ` for ${(effect.durationTicks / 30).toFixed(effect.durationTicks % 30 ? 1 : 0)}s`
        : "";
      const amount = effect.amount ? ` ${effect.amount}` : "";
      return `${effect.kind.replaceAll("-", " ")}${amount}${duration}`;
    })
    .join(" · ");
}

function abilityIconStyle(specId: SpecId, abilityId: string) {
  const index = SPECS[specId].abilities.findIndex(
    (ability) => ability.id === abilityId,
  );
  const column = Math.max(0, index) % 4;
  const row = Math.floor(Math.max(0, index) / 4);
  return {
    "background-image": `url(/ability-icons/${specId}-atlas.png)`,
    "background-position": `${(column / 3) * 100}% ${(row / 2) * 100}%`,
  };
}

function ActionBar(props: {
  player: PlayerState;
  state: MatchState;
  abilities: readonly AbilityDefinition[];
  tick: number;
  onUse: (id: string) => void;
  onReorder: (abilityIds: readonly string[]) => void;
}) {
  const spec = () => SPECS[props.player.specId];
  const isEnergy = () => props.player.specId === "subtlety-rogue";
  const globalCooldownRemaining = () =>
    Math.max(0, props.player.globalCooldownUntil - props.tick);
  const [draggedId, setDraggedId] = createSignal<string>();
  const [dragOverId, setDragOverId] = createSignal<string>();
  function moveAbility(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const order = props.abilities.map(({ id }) => id);
    const sourceIndex = order.indexOf(sourceId);
    const targetIndex = order.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    order.splice(sourceIndex, 1);
    order.splice(targetIndex, 0, sourceId);
    props.onReorder(order);
  }
  function moveAbilityBy(sourceId: string, offset: number) {
    const order = props.abilities.map(({ id }) => id);
    const sourceIndex = order.indexOf(sourceId);
    const targetIndex = Math.max(
      0,
      Math.min(order.length - 1, sourceIndex + offset),
    );
    if (sourceIndex < 0 || targetIndex === sourceIndex) return;
    [order[sourceIndex], order[targetIndex]] = [
      order[targetIndex]!,
      order[sourceIndex]!,
    ];
    props.onReorder(order);
  }
  return (
    <footer class="action-dock" style={{ "--spec": spec().color }}>
      <div class="actions">
        <For each={props.abilities}>
          {(ability, index) => {
            const remaining = () =>
              Math.max(
                0,
                (props.player.cooldowns[ability.id] ?? 0) - props.tick,
              );
            const lacksResource = () => props.player.mana < ability.manaCost;
            const combatLocked = () =>
              ability.id === "stealth" &&
              (props.player.combatUntilTick ?? 0) > props.tick;
            const unavailable = () =>
              remaining() > 0 || lacksResource() || combatLocked();
            const rangeTarget = () => {
              if (
                ability.target === "self" ||
                ability.target === "point" ||
                ability.target === "enemy-area" ||
                ability.target === "enemy-cone"
              )
                return undefined;
              const selected = props.state.players[props.player.targetId ?? ""];
              if (ability.target === "ally")
                return selected?.team === props.player.team
                  ? selected
                  : props.player;
              if (ability.target === "any") return selected ?? props.player;
              return selected?.team !== props.player.team
                ? selected
                : undefined;
            };
            const outOfRange = () => {
              const target = rangeTarget();
              return (
                !!target &&
                ability.range > 0 &&
                Math.hypot(
                  target.x - props.player.x,
                  target.y - props.player.y,
                ) > ability.range
              );
            };
            return (
              <button
                type="button"
                draggable="true"
                aria-label={`${ability.name}, bound to ${ABILITY_BINDS[index()]?.toUpperCase() ?? "unbound"}. Hold Alt and press an arrow key to move this ability.`}
                aria-describedby={`ability-tooltip-${ability.id}`}
                aria-disabled={unavailable()}
                classList={{
                  unavailable: unavailable(),
                  "lacks-resource": lacksResource(),
                  "combat-locked": combatLocked(),
                  "out-of-range": outOfRange(),
                  dragging: draggedId() === ability.id,
                  "drag-over": dragOverId() === ability.id,
                }}
                onClick={() => !unavailable() && props.onUse(ability.id)}
                onDragStart={(event) => {
                  setDraggedId(ability.id);
                  event.dataTransfer?.setData("text/plain", ability.id);
                  if (event.dataTransfer)
                    event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverId(ability.id);
                  if (event.dataTransfer)
                    event.dataTransfer.dropEffect = "move";
                }}
                onDragLeave={() =>
                  dragOverId() === ability.id && setDragOverId(undefined)
                }
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId =
                    event.dataTransfer?.getData("text/plain") || draggedId();
                  if (sourceId) moveAbility(sourceId, ability.id);
                  setDraggedId(undefined);
                  setDragOverId(undefined);
                }}
                onDragEnd={() => {
                  setDraggedId(undefined);
                  setDragOverId(undefined);
                }}
                onKeyDown={(event) => {
                  if (!event.altKey) return;
                  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                    event.preventDefault();
                    event.stopPropagation();
                    moveAbilityBy(ability.id, -1);
                  } else if (
                    event.key === "ArrowRight" ||
                    event.key === "ArrowDown"
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    moveAbilityBy(ability.id, 1);
                  }
                }}
              >
                <kbd>{ABILITY_BINDS[index()]?.toUpperCase() ?? "—"}</kbd>
                <span
                  class="ability-glyph"
                  style={abilityIconStyle(props.player.specId, ability.id)}
                  aria-hidden="true"
                />
                <Show when={globalCooldownRemaining() > 0}>
                  <span
                    class="global-cooldown-watch"
                    style={{
                      "--gcd-angle": `${360 * (1 - globalCooldownRemaining() / 30)}deg`,
                    }}
                    aria-hidden="true"
                  />
                </Show>
                <span class="ability-name">{ability.name}</span>
                <Show when={remaining() > 0}>
                  <em>{(remaining() / 30).toFixed(1)}</em>
                </Show>
                <div
                  id={`ability-tooltip-${ability.id}`}
                  class="ability-tooltip"
                  role="tooltip"
                >
                  <b>{ability.name}</b>
                  <p>{abilityEffectText(ability)}</p>
                  <dl>
                    <Show when={ability.manaCost > 0}>
                      <div>
                        <dt>{isEnergy() ? "Energy" : "Mana"}</dt>
                        <dd>{ability.manaCost}</dd>
                      </div>
                    </Show>
                    <Show when={ability.castTicks > 0}>
                      <div>
                        <dt>Cast</dt>
                        <dd>{(ability.castTicks / 30).toFixed(1)}s</dd>
                      </div>
                    </Show>
                    <Show when={ability.cooldownTicks > 0}>
                      <div>
                        <dt>Cooldown</dt>
                        <dd>{(ability.cooldownTicks / 30).toFixed(0)}s</dd>
                      </div>
                    </Show>
                    <Show when={ability.range > 0}>
                      <div>
                        <dt>Range</dt>
                        <dd>{Math.round(ability.range / UNITS_PER_YARD)} yd</dd>
                      </div>
                    </Show>
                  </dl>
                </div>
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
  let logElement!: HTMLElement;
  let followsLatest = true;

  const timestamp = (tick: number) => {
    const totalSeconds = Math.floor(tick / 30);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const updateFollowState = () => {
    const distanceFromBottom =
      logElement.scrollHeight - logElement.scrollTop - logElement.clientHeight;
    followsLatest = distanceFromBottom <= 4;
  };

  createEffect(() => {
    const latestEvent = props.events.at(-1);
    if (latestEvent) {
      latestEvent.tick;
      latestEvent.text;
    }

    queueMicrotask(() => {
      if (followsLatest) logElement.scrollTop = logElement.scrollHeight;
    });
  });

  return (
    <aside
      ref={logElement}
      class="log"
      aria-label="Combat log"
      onScroll={updateFollowState}
    >
      <For each={props.events}>
        {(event) => (
          <div class="log-entry">
            <span>{event.text}</span>
            <time datetime={`PT${Math.floor(event.tick / 30)}S`}>
              {timestamp(event.tick)}
            </time>
          </div>
        )}
      </For>
    </aside>
  );
}

render(() => <App />, document.getElementById("root")!);
