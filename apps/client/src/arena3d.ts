import * as THREE from "three";
import { PILLARS, type MatchState } from "@arena/simulation";
import { SPECS } from "@arena/game-content";
import { createSpellEffects, spellColor } from "./spell-effects";

export const cameraHeading = { yaw: -Math.PI / 2 };

/** Presentation only: positions and combat always come from the server. */
export function mountArena(
  canvas: HTMLCanvasElement,
  read: () => MatchState | undefined,
  selfId: () => string | undefined,
  select: (id: string) => void,
) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
  const units = new Map<
    string,
    {
      group: THREE.Group;
      legs: THREE.Mesh[];
      ring: THREE.Mesh;
      bar: THREE.Sprite;
      arms: THREE.Group[];
      glow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
      aura: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
    }
  >();
  const effects = createSpellEffects(scene);
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
          const cloth = new THREE.MeshStandardMaterial({
            color: SPECS[p.specId].color,
            roughness: 0.65,
          });
          const dark = new THREE.MeshStandardMaterial({ color: 0x222532 });
          mesh(
            new THREE.CylinderGeometry(0.45, 0.62, 1.15, 8),
            cloth,
            0,
            1.4,
            0,
            group,
          );
          mesh(
            new THREE.SphereGeometry(0.33, 12, 10),
            new THREE.MeshStandardMaterial({ color: 0xd8b28d }),
            0,
            2.22,
            0,
            group,
          );
          const legs = [-0.24, 0.24].map((x) =>
            mesh(
              new THREE.BoxGeometry(0.29, 0.85, 0.34),
              dark,
              x,
              0.48,
              0,
              group,
            ),
          );
          const arms = [-0.65, 0.65].map((x) => {
            const pivot = new THREE.Group();
            pivot.position.set(x, 1.85, 0);
            group.add(pivot);
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
          group.add(glow);
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
            group,
          );
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
          unit = { group, legs, ring, bar, arms, glow, aura };
          units.set(p.id, unit);
        }
        const destination = new THREE.Vector3(p.x / 25, 0, p.y / 25);
        const motion = destination.clone().sub(unit.group.position);
        if (motion.length() > 4) unit.group.position.copy(destination);
        else unit.group.position.lerp(destination, 1 - Math.exp(-18 * dt));
        if (motion.length() > 0.02)
          unit.group.rotation.y = Math.atan2(motion.x, motion.z);
        unit.legs.forEach(
          (leg, i) =>
            (leg.rotation.x =
              motion.length() > 0.02
                ? Math.sin(now * 0.012 + i * Math.PI) * 0.55
                : 0),
        );
        unit.group.rotation.z = p.health <= 0 ? Math.PI / 2 : 0;
        unit.ring.visible = me?.targetId === p.id || p.id === me?.id;
        unit.bar.scale.x = (1.7 * p.health) / SPECS[p.specId].maxHealth;
        const casting = !!p.cast && p.health > 0;
        const elapsed = (now - (effects.gestures.get(p.id) ?? -10000)) / 1000;
        const release = elapsed < 0.4 ? Math.sin((elapsed / 0.4) * Math.PI) : 0;
        unit.arms.forEach((arm, i) => {
          arm.rotation.x = casting
            ? -1.5 + Math.sin(now * 0.008 + i) * 0.12
            : -release * 1.8;
          arm.rotation.z = casting ? (i === 0 ? -0.25 : 0.25) : 0;
        });
        const target = state.players[p.cast?.targetId ?? p.targetId ?? ""];
        if ((casting || release > 0) && target)
          unit.group.rotation.y = Math.atan2(target.x - p.x, target.y - p.y);
        unit.glow.visible = casting;
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
    cancelAnimationFrame(frame);
    resize.disconnect();
    effects.dispose();
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
      if (o instanceof THREE.Sprite) o.material.dispose();
    });
    renderer.dispose();
  };
}
