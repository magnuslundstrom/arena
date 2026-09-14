import * as THREE from "three";
import type { MatchState } from "@arena/simulation";
import { playAbilitySound } from "./ability-audio";

export function spellColor(id: string) {
  if (/heal|renew|mending|shield|suppression|dispel/.test(id)) return 0xffe99a;
  if (/shadow|vanish|stealth|mana-burn|scream|polymorph/.test(id))
    return 0xc079ff;
  if (/fire/.test(id)) return 0xff873b;
  if (/hemorrhage|shot|gouge|kick|eviscerate/.test(id)) return 0xff5965;
  return 0x78dfff;
}

/** Effects consume confirmed events once; animation never applies combat outcomes. */
export function createSpellEffects(scene: THREE.Scene) {
  const root = new THREE.Group();
  scene.add(root);
  const sphere = new THREE.SphereGeometry(1, 8, 6);
  const ring = new THREE.TorusGeometry(1, 0.045, 6, 36);
  const coneWave = new THREE.RingGeometry(
    0.12,
    1,
    32,
    1,
    -Math.PI / 4,
    Math.PI / 2,
  );
  coneWave.rotateX(-Math.PI / 2);
  const active: {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    start: THREE.Vector3;
    end: THREE.Vector3;
    age: number;
    life: number;
    size: number;
    type: "bolt" | "particle" | "ring" | "nova" | "cone";
    color: number;
  }[] = [];
  const combatText: {
    sprite: THREE.Sprite;
    targetId: string;
    age: number;
    life: number;
    offsetX: number;
  }[] = [];
  let consumedTick = -1;
  const gestures = new Map<string, { at: number; abilityId: string }>();

  function spawnCombatText(
    targetId: string,
    amount: number,
    type: "damage" | "heal",
    eventIndex: number,
  ) {
    if (amount <= 0 || combatText.length >= 40) return;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = "900 68px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineWidth = 12;
    context.strokeStyle = "rgba(20, 10, 8, 0.95)";
    const label = type === "heal" ? `+${amount}` : String(amount);
    context.strokeText(label, 128, 66);
    context.fillStyle = type === "heal" ? "#63ef8b" : "#ffd45c";
    context.fillText(label, 128, 66);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.6, 1.3, 1);
    sprite.renderOrder = 20;
    root.add(sprite);
    combatText.push({
      sprite,
      targetId,
      age: 0,
      life: 1.25,
      offsetX: ((eventIndex % 3) - 1) * 0.42,
    });
  }
  function spawn(
    type: "bolt" | "particle" | "ring" | "nova" | "cone",
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    size: number,
    life: number,
  ) {
    if (active.length >= 240) return undefined;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const geometry =
      type === "cone"
        ? coneWave
        : type === "ring" || type === "nova"
          ? ring
          : sphere;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(start);
    mesh.scale.setScalar(size);
    if (type === "ring" || type === "nova") mesh.rotation.x = Math.PI / 2;
    root.add(mesh);
    active.push({
      mesh,
      start: start.clone(),
      end: end.clone(),
      age: 0,
      life,
      size,
      type,
      color,
    });
    return mesh;
  }
  function burst(position: THREE.Vector3, color: number) {
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6;
      spawn(
        "particle",
        position,
        position
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(angle) * 1.6,
              (i % 3) * 0.6,
              Math.sin(angle) * 1.6,
            ),
          ),
        color,
        0.12,
        0.55,
      );
    }
  }
  return {
    gestures,
    update(state: MatchState | undefined, now: number, dt: number) {
      if (state) {
        for (const [eventIndex, event] of state.events.entries()) {
          if (event.tick <= consumedTick) continue;
          const source = state.players[event.sourceId ?? ""];
          const target = state.players[event.targetId ?? ""];
          const id = event.abilityId ?? "renew";
          const color = spellColor(id);
          const from = source
            ? new THREE.Vector3(source.x / 25, 1.7, source.y / 25)
            : undefined;
          const to = target
            ? new THREE.Vector3(target.x / 25, 1.4, target.y / 25)
            : from;
          if (
            event.type === "damage" &&
            id.startsWith("auto-attack-") &&
            source
          )
            gestures.set(source.id, { at: now, abilityId: id });
          if (event.type === "ability" && source && from && to) {
            const pan = Math.max(-1, Math.min(1, (source.x - 1500) / 1500));
            const distance = Math.hypot(source.x - 1500, source.y - 1000);
            playAbilitySound(id, pan, Math.max(0.45, 1 - distance / 4000));
            gestures.set(source.id, { at: now, abilityId: id });
            if (id === "frost-nova") {
              burst(from, color);
              spawn(
                "nova",
                from.clone().setY(0.12),
                from.clone().setY(0.12),
                color,
                28,
                0.72,
              );
            } else if (id === "cone-of-cold") {
              const dx = source.facingX;
              const dz = source.facingY;
              const effectStart = from.clone().setY(0.1);
              const wave = spawn(
                "cone",
                effectStart,
                effectStart,
                color,
                17.2,
                0.58,
              );
              if (wave) wave.rotation.y = -Math.atan2(dz, dx);
              for (let i = -3; i <= 3; i++) {
                const angle = Math.atan2(dz, dx) + (i * Math.PI) / 24;
                spawn(
                  "particle",
                  from,
                  from
                    .clone()
                    .add(
                      new THREE.Vector3(
                        Math.cos(angle) * 16.4,
                        0.15 + Math.abs(i) * 0.08,
                        Math.sin(angle) * 16.4,
                      ),
                    ),
                  color,
                  0.15,
                  0.55,
                );
              }
            } else if (
              /bolt|lance|fire-blast|shadow-word-death/.test(id) &&
              from.distanceTo(to) > 2
            )
              spawn("bolt", from, to, color, 0.23, 0.28);
            else {
              burst(to, color);
              spawn(
                "ring",
                to.clone().setY(0.12),
                to.clone().setY(0.12),
                color,
                1,
                0.7,
              );
            }
          } else if (
            (event.type === "damage" ||
              event.type === "heal" ||
              event.type === "control") &&
            to
          ) {
            if (event.type === "heal")
              spawn(
                "ring",
                to.clone().setY(0.1),
                to.clone().setY(2.4),
                0x9cffbf,
                0.8,
                0.8,
              );
            else if (!/bolt|lance|fire-blast|shadow-word-death/.test(id))
              burst(to, color);
          }
          if (
            (event.type === "damage" || event.type === "heal") &&
            event.targetId &&
            event.amount !== undefined
          )
            spawnCombatText(
              event.targetId,
              event.amount,
              event.type,
              eventIndex,
            );
        }
        consumedTick = state.tick;
      }
      for (let i = active.length - 1; i >= 0; i--) {
        const effect = active[i]!;
        effect.age += dt;
        const t = Math.min(1, effect.age / effect.life);
        effect.mesh.position.lerpVectors(effect.start, effect.end, t);
        effect.mesh.material.opacity = (1 - t) * 0.9;
        effect.mesh.scale.setScalar(
          effect.type === "nova" || effect.type === "cone"
            ? effect.size * t
            : effect.type === "ring"
              ? effect.size * (1 + t * 2)
              : effect.size * (1 - t * 0.6),
        );
        if (t >= 1) {
          root.remove(effect.mesh);
          effect.mesh.material.dispose();
          active.splice(i, 1);
          if (effect.type === "bolt") burst(effect.end, effect.color);
        }
      }
      for (let i = combatText.length - 1; i >= 0; i--) {
        const text = combatText[i]!;
        text.age += dt;
        const t = Math.min(1, text.age / text.life);
        const target = state?.players[text.targetId];
        if (target)
          text.sprite.position.set(
            target.x / 25 + text.offsetX,
            3.25 + Math.sin(t * Math.PI * 0.5) * 1.6,
            target.y / 25,
          );
        text.sprite.material.opacity =
          t < 0.72 ? 1 : 1 - (t - 0.72) / (1 - 0.72);
        const pop = 1 + Math.sin(Math.min(1, t * 5) * Math.PI) * 0.18;
        text.sprite.scale.set(2.6 * pop, 1.3 * pop, 1);
        if (t >= 1 || !target) {
          root.remove(text.sprite);
          text.sprite.material.map?.dispose();
          text.sprite.material.dispose();
          combatText.splice(i, 1);
        }
      }
    },
    dispose() {
      for (const effect of active) effect.mesh.material.dispose();
      for (const text of combatText) {
        text.sprite.material.map?.dispose();
        text.sprite.material.dispose();
      }
      sphere.dispose();
      ring.dispose();
      coneWave.dispose();
      scene.remove(root);
    },
  };
}
