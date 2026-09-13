import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { PILLARS, type MatchState } from "@arena/simulation";
import { SPECS } from "@arena/game-content";
import { createSpellEffects, spellColor } from "./spell-effects";

export const cameraHeading = { yaw: -Math.PI / 2 };

interface ArenaUnit {
  specId: string;
  group: THREE.Group;
  humanoid: THREE.Group;
  proxy: THREE.Group;
  sheep: THREE.Group;
  legs: THREE.Mesh[];
  ring: THREE.Mesh;
  bar: THREE.Sprite;
  arms: THREE.Group[];
  glow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  aura: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  fearIcon: THREE.Sprite;
  stunIcon: THREE.Sprite;
  incapacitateIcon: THREE.Sprite;
  rootIcon: THREE.Sprite;
  rootIce: THREE.Group;
  mixer?: THREE.AnimationMixer;
  actions?: Map<string, THREE.AnimationAction>;
  currentAction?: string;
}

function playAnimation(unit: ArenaUnit, name: string) {
  if (!unit.actions || unit.currentAction === name) return;
  const next = unit.actions.get(name) ?? unit.actions.get("Idle");
  if (!next) return;
  const previous = unit.currentAction
    ? unit.actions.get(unit.currentAction)
    : undefined;
  previous?.fadeOut(0.16);
  next.reset().fadeIn(0.16).play();
  unit.currentAction = name;
}

function createStatusIcon(symbol: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgba(13, 10, 22, 0.82)";
  context.beginPath();
  context.arc(64, 64, 48, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 8;
  context.stroke();
  context.font = "900 70px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.fillText(symbol, 64, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  sprite.scale.set(0.85, 0.85, 1);
  sprite.renderOrder = 15;
  return sprite;
}

/** Presentation only: positions and combat always come from the server. */
export function mountArena(
  canvas: HTMLCanvasElement,
  read: () => MatchState | undefined,
  selfId: () => string | undefined,
  select: (id: string) => void,
) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222f46);
  scene.fog = new THREE.Fog(0x222f46, 38, 100);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 160);
  scene.add(new THREE.HemisphereLight(0xbddaff, 0x514336, 2.3));
  const sun = new THREE.DirectionalLight(0xffe0b3, 3);
  sun.position.set(15, 30, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  scene.add(sun);
  const stone = new THREE.MeshStandardMaterial({
    color: 0x777b80,
    roughness: 0.95,
  });
  function mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = scene,
  ) {
    const item = new THREE.Mesh(geometry, material);
    item.position.set(x, y, z);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  }
  mesh(
    new THREE.BoxGeometry(80, 1, 48),
    new THREE.MeshStandardMaterial({ color: 0x6d665d, roughness: 1 }),
    40,
    -0.5,
    24,
  );
  const grid = new THREE.GridHelper(80, 40, 0x888477, 0x787369);
  grid.position.set(40, 0.015, 24);
  grid.scale.z = 0.6;
  scene.add(grid);
  for (const p of PILLARS) {
    mesh(
      new THREE.CylinderGeometry(p.radius / 25, p.radius / 25, 7, 12),
      stone,
      p.x / 25,
      3.5,
      p.y / 25,
    );
    mesh(
      new THREE.CylinderGeometry(
        p.radius / 25 + 0.4,
        p.radius / 25 + 0.4,
        0.65,
        12,
      ),
      stone,
      p.x / 25,
      7,
      p.y / 25,
    );
    mesh(
      new THREE.CylinderGeometry(
        p.radius / 25 + 0.5,
        p.radius / 25 + 0.5,
        0.6,
        12,
      ),
      stone,
      p.x / 25,
      0.3,
      p.y / 25,
    );
  }
  for (const z of [0, 48])
    mesh(new THREE.BoxGeometry(80, 3, 1), stone, 40, 1.5, z);
  for (const x of [0, 80])
    mesh(new THREE.BoxGeometry(1, 3, 48), stone, x, 1.5, 24);
  for (let x = 0; x <= 80; x += 8)
    for (const z of [0, 48])
      mesh(new THREE.BoxGeometry(1.6, 5, 1.6), stone, x, 2.5, z);
  const units = new Map<string, ArenaUnit>();
  const effects = createSpellEffects(scene);
  let wizardScene: THREE.Group | undefined;
  let wizardAnimations: THREE.AnimationClip[] = [];
  let disposed = false;
  function attachWizard(unit: ArenaUnit) {
    if (!wizardScene || unit.mixer) return;
    const model = cloneSkeleton(wizardScene);
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 2.55 / Math.max(0.01, size.y);
    model.scale.setScalar(scale);
    model.position.y = -bounds.min.y * scale;
    unit.humanoid.add(model);
    unit.proxy.visible = false;
    unit.mixer = new THREE.AnimationMixer(model);
    unit.actions = new Map(
      wizardAnimations.map((clip) => [clip.name, unit.mixer!.clipAction(clip)]),
    );
    const death = unit.actions.get("Death");
    death?.setLoop(THREE.LoopOnce, 1);
    if (death) death.clampWhenFinished = true;
    playAnimation(unit, "Idle");
  }
  new GLTFLoader().load(
    "/models/undead-frost-mage/model.gltf",
    (asset) => {
      if (disposed) return;
      wizardScene = asset.scene;
      wizardAnimations = asset.animations;
      for (const unit of units.values())
        if (unit.specId === "frost-mage") attachWizard(unit);
    },
    undefined,
    () => {
      // The procedural model remains visible as a resilient fallback.
    },
  );
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pitch = 0.34,
    zoom = 10,
    dragging = false,
    lastX = 0,
    lastY = 0,
    frame = 0,
    lastTime = performance.now(),
    initialized = false;
  const resize = new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  });
  resize.observe(canvas);
  const down = (e: PointerEvent) => {
    if (e.button === 2) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    }
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    cameraHeading.yaw -= (e.clientX - lastX) * 0.006;
    pitch = THREE.MathUtils.clamp(
      pitch + (e.clientY - lastY) * 0.004,
      0.08,
      1.1,
    );
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const up = () => {
    dragging = false;
  };
  const menu = (e: Event) => e.preventDefault();
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    zoom = THREE.MathUtils.clamp(zoom + e.deltaY * 0.012, 4, 19);
  };
  const click = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(
      [...units.values()].map((u) => u.group),
      true,
    );
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.playerId) node = node.parent;
      if (node) {
        select(String(node.userData.playerId));
        break;
      }
    }
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("contextmenu", menu);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("click", click);
  function draw(now: number) {
    frame = requestAnimationFrame(draw);
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const state = read();
    const me = state?.players[selfId() ?? ""];
    if (me && !initialized) {
      cameraHeading.yaw = me.team === 0 ? -Math.PI / 2 : Math.PI / 2;
      initialized = true;
    }
    for (const [id, u] of units) u.group.visible = !!state?.players[id];
    if (state)
      for (const p of Object.values(state.players)) {
        let unit = units.get(p.id);
        if (!unit) {
          const group = new THREE.Group();
          group.userData.playerId = p.id;
          scene.add(group);
          const humanoid = new THREE.Group();
          group.add(humanoid);
          const proxy = new THREE.Group();
          humanoid.add(proxy);
          const cloth = new THREE.MeshStandardMaterial({
            color: p.specId === "frost-mage" ? 0x293b58 : SPECS[p.specId].color,
            roughness: 0.65,
          });
          const dark = new THREE.MeshStandardMaterial({ color: 0x222532 });
          mesh(
            new THREE.CylinderGeometry(0.45, 0.62, 1.15, 8),
            cloth,
            0,
            1.4,
            0,
            proxy,
          );
          mesh(
            new THREE.SphereGeometry(0.33, 12, 10),
            new THREE.MeshStandardMaterial({
              color: p.specId === "frost-mage" ? 0xaebdc3 : 0xd8b28d,
              roughness: 0.82,
            }),
            0,
            2.22,
            0,
            proxy,
          );
          const legs = [-0.24, 0.24].map((x) =>
            mesh(
              new THREE.BoxGeometry(0.29, 0.85, 0.34),
              dark,
              x,
              0.48,
              0,
              proxy,
            ),
          );
          const arms = [-0.65, 0.65].map((x) => {
            const pivot = new THREE.Group();
            pivot.position.set(x, 1.85, 0);
            proxy.add(pivot);
            mesh(
              new THREE.BoxGeometry(0.3, 0.85, 0.35),
              cloth,
              0,
              -0.4,
              0,
              pivot,
            );
            return pivot;
          });
          const glow = new THREE.Mesh(
            new THREE.SphereGeometry(0.24, 12, 8),
            new THREE.MeshBasicMaterial({
              color: 0x78dfff,
              transparent: true,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            }),
          );
          glow.position.set(0, 1.7, 0.95);
          proxy.add(glow);
          const aura = new THREE.Mesh(
            new THREE.SphereGeometry(1.15, 20, 14),
            new THREE.MeshBasicMaterial({
              color: 0x78dfff,
              transparent: true,
              opacity: 0.16,
              wireframe: true,
              depthWrite: false,
            }),
          );
          aura.position.y = 1.25;
          aura.scale.y = 1.35;
          group.add(aura);
          mesh(
            new THREE.BoxGeometry(
              0.12,
              p.specId === "subtlety-rogue" ? 0.8 : 2.3,
              0.12,
            ),
            new THREE.MeshStandardMaterial({
              color: 0xc5ab73,
              metalness: 0.5,
              roughness: 0.3,
            }),
            0.8,
            1.3,
            0.2,
            proxy,
          );
          if (p.specId === "frost-mage") {
            const teal = new THREE.MeshStandardMaterial({
              color: 0x22576a,
              roughness: 0.78,
            });
            const leather = new THREE.MeshStandardMaterial({
              color: 0x3a2923,
              roughness: 0.9,
            });
            const frost = new THREE.MeshStandardMaterial({
              color: 0x77e2ff,
              emissive: 0x167ca5,
              emissiveIntensity: 1.5,
              roughness: 0.15,
              transparent: true,
              opacity: 0.92,
            });
            const pale = new THREE.MeshBasicMaterial({ color: 0xa7efff });

            const mantle = mesh(
              new THREE.ConeGeometry(0.88, 0.72, 8, 1, true),
              teal,
              0,
              1.73,
              -0.08,
              proxy,
            );
            mantle.rotation.y = Math.PI / 8;
            mantle.scale.z = 0.72;
            const scarf = mesh(
              new THREE.TorusGeometry(0.39, 0.12, 7, 16),
              teal,
              0,
              2.02,
              0,
              proxy,
            );
            scarf.rotation.x = Math.PI / 2;
            mesh(
              new THREE.BoxGeometry(1.18, 0.16, 0.62),
              leather,
              0,
              1.12,
              0.02,
              proxy,
            );
            for (const x of [-0.28, 0.28])
              mesh(
                new THREE.BoxGeometry(0.48, 0.82, 0.12),
                teal,
                x,
                0.83,
                0.26,
                proxy,
              );
            mesh(
              new THREE.BoxGeometry(0.32, 0.38, 0.28),
              leather,
              0.53,
              0.92,
              0.36,
              proxy,
            );
            for (const x of [-0.13, 0.13])
              mesh(
                new THREE.SphereGeometry(0.045, 8, 6),
                pale,
                x,
                2.27,
                0.31,
                proxy,
              );
            const hair = new THREE.MeshStandardMaterial({
              color: 0xd9e0e8,
              roughness: 0.75,
            });
            for (let i = 0; i < 7; i++) {
              const angle = -1.2 + i * 0.4;
              const lock = mesh(
                new THREE.ConeGeometry(0.1, 0.48 + (i % 2) * 0.12, 5),
                hair,
                Math.sin(angle) * 0.24,
                2.58 + Math.cos(angle) * 0.06,
                -0.08 - Math.cos(angle) * 0.2,
                proxy,
              );
              lock.rotation.z = Math.sin(angle) * 0.55;
              lock.rotation.x = -0.45;
            }
            for (const arm of arms) {
              mesh(
                new THREE.CylinderGeometry(0.2, 0.2, 0.34, 8),
                leather,
                0,
                -0.57,
                0,
                arm,
              );
            }
            mesh(
              new THREE.OctahedronGeometry(0.3, 0),
              frost,
              0.8,
              2.66,
              0.2,
              proxy,
            );
            for (const x of [0.57, 1.03]) {
              const tine = mesh(
                new THREE.ConeGeometry(0.07, 0.62, 5),
                leather,
                x,
                2.48,
                0.2,
                proxy,
              );
              tine.rotation.z = x < 0.8 ? -0.35 : 0.35;
            }
          }
          const sheep = new THREE.Group();
          sheep.visible = false;
          group.add(sheep);
          const wool = new THREE.MeshStandardMaterial({
            color: 0xf4f0dc,
            roughness: 1,
          });
          const sheepDark = new THREE.MeshStandardMaterial({
            color: 0x3c3540,
            roughness: 0.85,
          });
          mesh(new THREE.SphereGeometry(0.68, 12, 10), wool, 0, 1.05, 0, sheep);
          for (const x of [-0.42, 0, 0.42])
            mesh(
              new THREE.SphereGeometry(0.43, 10, 8),
              wool,
              x,
              1.2 + (x === 0 ? 0.18 : 0),
              0,
              sheep,
            );
          mesh(
            new THREE.SphereGeometry(0.34, 10, 8),
            sheepDark,
            0,
            1.25,
            0.7,
            sheep,
          );
          for (const x of [-0.38, 0.38])
            for (const z of [-0.28, 0.28])
              mesh(
                new THREE.BoxGeometry(0.16, 0.62, 0.16),
                sheepDark,
                x,
                0.48,
                z,
                sheep,
              );
          const fearIcon = createStatusIcon("☠", "#cf7cff");
          fearIcon.position.set(0, 3.8, 0);
          fearIcon.visible = false;
          group.add(fearIcon);
          const stunIcon = createStatusIcon("★", "#ffe16b");
          stunIcon.position.set(0, 3.8, 0);
          stunIcon.visible = false;
          group.add(stunIcon);
          const incapacitateIcon = createStatusIcon("◎", "#ffb45f");
          incapacitateIcon.position.set(0, 3.8, 0);
          incapacitateIcon.visible = false;
          group.add(incapacitateIcon);
          const rootIcon = createStatusIcon("❄", "#8de8ff");
          rootIcon.position.set(0, 3.8, 0);
          rootIcon.visible = false;
          group.add(rootIcon);
          const rootIce = new THREE.Group();
          rootIce.visible = false;
          group.add(rootIce);
          const ice = new THREE.MeshStandardMaterial({
            color: 0x79ddff,
            emissive: 0x164c77,
            transparent: true,
            opacity: 0.82,
            roughness: 0.18,
          });
          for (let i = 0; i < 7; i++) {
            const angle = (i / 7) * Math.PI * 2;
            const shard = mesh(
              new THREE.ConeGeometry(
                0.18 + (i % 2) * 0.06,
                0.8 + (i % 3) * 0.2,
                5,
              ),
              ice,
              Math.cos(angle) * 0.72,
              0.38,
              Math.sin(angle) * 0.72,
              rootIce,
            );
            shard.rotation.z = Math.cos(angle) * 0.2;
            shard.rotation.x = Math.sin(angle) * 0.2;
          }
          const frostRing = mesh(
            new THREE.TorusGeometry(0.82, 0.09, 6, 30),
            ice,
            0,
            0.08,
            0,
            rootIce,
          );
          frostRing.rotation.x = Math.PI / 2;
          const ring = mesh(
            new THREE.TorusGeometry(0.9, 0.045, 8, 40),
            new THREE.MeshBasicMaterial({ color: 0xffdf79 }),
            0,
            0.055,
            0,
            group,
          );
          ring.rotation.x = Math.PI / 2;
          const bar = new THREE.Sprite(
            new THREE.SpriteMaterial({
              color: p.team === 0 ? 0x61acff : 0xf46b7d,
            }),
          );
          bar.position.set(0, 2.9, 0);
          bar.scale.set(1.7, 0.12, 1);
          group.add(bar);
          group.position.set(p.x / 25, 0, p.y / 25);
          group.rotation.y = p.team === 0 ? Math.PI / 2 : -Math.PI / 2;
          unit = {
            specId: p.specId,
            group,
            humanoid,
            proxy,
            sheep,
            legs,
            ring,
            bar,
            arms,
            glow,
            aura,
            fearIcon,
            stunIcon,
            incapacitateIcon,
            rootIcon,
            rootIce,
          };
          units.set(p.id, unit);
          if (p.specId === "frost-mage") attachWizard(unit);
        }
        const polymorphed =
          p.health > 0 && (p.statuses.polymorph ?? 0) > state.tick;
        const feared = p.health > 0 && (p.statuses.fear ?? 0) > state.tick;
        const stunned = p.health > 0 && (p.statuses.stun ?? 0) > state.tick;
        const incapacitated =
          p.health > 0 && (p.statuses.incapacitate ?? 0) > state.tick;
        const rooted = p.health > 0 && (p.statuses.root ?? 0) > state.tick;
        const jumping =
          p.jumpStartedTick !== undefined &&
          p.jumpUntilTick !== undefined &&
          p.jumpUntilTick > state.tick;
        const jumpProgress = jumping
          ? (state.tick - p.jumpStartedTick!) /
            Math.max(1, p.jumpUntilTick! - p.jumpStartedTick!)
          : 0;
        const jumpHeight = jumping
          ? Math.sin(Math.PI * THREE.MathUtils.clamp(jumpProgress, 0, 1)) * 2.2
          : 0;
        const destination = new THREE.Vector3(p.x / 25, jumpHeight, p.y / 25);
        const motion = destination.clone().sub(unit.group.position);
        if (motion.length() > 4) unit.group.position.copy(destination);
        else unit.group.position.lerp(destination, 1 - Math.exp(-18 * dt));
        if (motion.length() > 0.02)
          unit.group.rotation.y = Math.atan2(motion.x, motion.z);
        unit.humanoid.visible = !polymorphed;
        unit.humanoid.position.y = stunned ? -0.12 : 0;
        unit.humanoid.rotation.z = incapacitated
          ? Math.sin(now * 0.008) * 0.12
          : 0;
        unit.sheep.visible = polymorphed;
        unit.sheep.position.y = polymorphed ? Math.sin(now * 0.009) * 0.08 : 0;
        unit.sheep.rotation.y = Math.sin(now * 0.004) * 0.12;
        unit.fearIcon.visible = feared;
        unit.fearIcon.position.x = Math.sin(now * 0.01) * 0.22;
        unit.fearIcon.position.y = 3.75 + Math.sin(now * 0.013) * 0.12;
        unit.stunIcon.visible = stunned;
        unit.stunIcon.position.x = Math.sin(now * 0.014) * 0.32;
        unit.stunIcon.position.y = 3.7 + Math.cos(now * 0.014) * 0.12;
        unit.stunIcon.material.rotation = now * 0.003;
        unit.incapacitateIcon.visible = incapacitated;
        unit.incapacitateIcon.position.x = Math.sin(now * 0.011) * 0.26;
        unit.incapacitateIcon.position.y = 3.72 + Math.cos(now * 0.011) * 0.1;
        unit.incapacitateIcon.material.rotation = -now * 0.002;
        unit.rootIcon.visible = rooted;
        unit.rootIcon.position.x =
          feared || stunned || incapacitated ? -0.7 : 0;
        unit.rootIcon.position.y = 3.72 + Math.sin(now * 0.008) * 0.08;
        unit.rootIcon.material.rotation = Math.sin(now * 0.004) * 0.12;
        unit.rootIce.visible = rooted;
        unit.rootIce.position.y = -jumpHeight;
        unit.rootIce.rotation.y = now * 0.00035;
        unit.legs.forEach((leg, i) => {
          leg.rotation.x = stunned
            ? i === 0
              ? 0.18
              : -0.18
            : jumping
              ? 0.65 + i * -0.18
              : motion.length() > 0.02
                ? Math.sin(now * 0.012 + i * Math.PI) * 0.55
                : 0;
        });
        unit.group.rotation.z = p.health <= 0 && !unit.mixer ? Math.PI / 2 : 0;
        unit.ring.visible = me?.targetId === p.id || p.id === me?.id;
        unit.bar.scale.x = (1.7 * p.health) / SPECS[p.specId].maxHealth;
        const casting = !!p.cast && p.health > 0;
        unit.mixer?.update(dt);
        playAnimation(
          unit,
          p.health <= 0
            ? "Death"
            : casting
              ? "Spell1"
              : stunned || incapacitated
                ? "RecieveHit"
                : feared || jumping || motion.length() > 0.02
                  ? "Run"
                  : "Idle",
        );
        const elapsed = (now - (effects.gestures.get(p.id) ?? -10000)) / 1000;
        const release = elapsed < 0.4 ? Math.sin((elapsed / 0.4) * Math.PI) : 0;
        unit.arms.forEach((arm, i) => {
          arm.rotation.x = stunned
            ? -0.35
            : casting
              ? -1.5 + Math.sin(now * 0.008 + i) * 0.12
              : -release * 1.8;
          arm.rotation.z = stunned
            ? i === 0
              ? -0.85
              : 0.85
            : casting
              ? i === 0
                ? -0.25
                : 0.25
              : 0;
        });
        const target = state.players[p.cast?.targetId ?? p.targetId ?? ""];
        if ((casting || release > 0) && target)
          unit.group.rotation.y = Math.atan2(target.x - p.x, target.y - p.y);
        unit.glow.visible = casting && !polymorphed;
        unit.glow.material.color.setHex(spellColor(p.cast?.abilityId ?? ""));
        unit.glow.scale.setScalar(0.8 + Math.sin(now * 0.012) * 0.25);
        unit.aura.visible =
          p.health > 0 &&
          (p.shield > 0 ||
            (p.statuses.immunity ?? 0) > state.tick ||
            (p.statuses["damage-reduction"] ?? 0) > state.tick);
        unit.aura.material.color.setHex(
          (p.statuses.immunity ?? 0) > state.tick
            ? 0xb3eeff
            : p.specId === "discipline-priest"
              ? 0xffdf7a
              : 0x78dfff,
        );
        unit.aura.rotation.y = now * 0.0005;
      }
    effects.update(state, now, dt);
    if (me) {
      const u = units.get(me.id)!;
      const focus = u.group.position.clone().add(new THREE.Vector3(0, 1.65, 0));
      const offset = new THREE.Vector3(
        Math.sin(cameraHeading.yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(cameraHeading.yaw) * Math.cos(pitch),
      ).multiplyScalar(zoom);
      raycaster.set(focus, offset.clone().normalize());
      const blockers = raycaster
        .intersectObjects(
          scene.children.filter((o) => o instanceof THREE.Mesh),
          false,
        )
        .filter((h) => h.distance > 1 && h.distance < zoom);
      if (blockers[0])
        offset.setLength(Math.max(2, blockers[0].distance - 0.4));
      camera.position.copy(focus).add(offset);
      camera.lookAt(focus);
    }
    renderer.render(scene, camera);
  }
  frame = requestAnimationFrame(draw);
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    effects.dispose();
    for (const unit of units.values()) unit.mixer?.stopAllAction();
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    canvas.removeEventListener("contextmenu", menu);
    canvas.removeEventListener("wheel", wheel);
    canvas.removeEventListener("click", click);
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach((m) => m.dispose());
      }
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    renderer.dispose();
  };
}
