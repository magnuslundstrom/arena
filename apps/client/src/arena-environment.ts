import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PILLARS } from "@arena/simulation";

function prepare(model: THREE.Group, receiveShadow = true) {
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = !receiveShadow;
      object.receiveShadow = receiveShadow;
      const wasArray = Array.isArray(object.material);
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      object.material = materials.map((source) => {
        const material = source.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.multiply(
            new THREE.Color(receiveShadow ? 0x716a62 : 0x7c8189),
          );
          material.roughness = Math.max(0.82, material.roughness);
        }
        return material;
      });
      if (!wasArray)
        object.material = (object.material as THREE.Material[])[0]!;
    }
  });
  return model;
}

/** Authored presentation shell. Simulation collision remains in arena3d. */
export function mountArenaEnvironment(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.name = "authored-arena-environment";
  scene.add(root);
  const loader = new GLTFLoader();
  let disposed = false;

  function load(path: string, build: (model: THREE.Group) => void) {
    loader.load(path, (asset) => {
      if (!disposed) build(asset.scene);
    });
  }

  function place(
    source: THREE.Group,
    x: number,
    y: number,
    z: number,
    rotation = 0,
    scale = new THREE.Vector3(1, 1, 1),
  ) {
    const model = source.clone(true);
    model.position.set(x, y, z);
    model.rotation.y = rotation;
    model.scale.copy(scale);
    root.add(model);
    return model;
  }

  for (const [file, parity] of [
    ["floor-a.glb", 0],
    ["floor-b.glb", 1],
  ] as const)
    load(`/models/arena-dungeon/${file}`, (asset) => {
      prepare(asset);
      for (let x = 2; x < 80; x += 4)
        for (let z = 2; z < 48; z += 4)
          if ((x / 4 + z / 4) % 2 === parity) place(asset, x, 0.025, z);
    });

  for (const [file, detailed] of [
    ["wall.glb", false],
    ["wall-detail.glb", true],
  ] as const)
    load(`/models/arena-dungeon/${file}`, (asset) => {
      prepare(asset, false);
      for (let x = 4; x <= 76; x += 4) {
        if (x === 40 || (x / 4) % 2 === Number(detailed)) continue;
        place(asset, x, 0, 0, 0);
        place(asset, x, 0, 48, Math.PI);
      }
      for (let z = 4; z <= 44; z += 4) {
        if (z === 24 || (z / 4) % 2 === Number(detailed)) continue;
        place(asset, 0, 0, z, -Math.PI / 2);
        place(asset, 80, 0, z, Math.PI / 2);
      }
    });

  load("/models/arena-dungeon/gate.glb", (asset) => {
    prepare(asset, false);
    place(asset, 40, 0, 0, 0, new THREE.Vector3(1.8, 1.15, 1.15));
    place(asset, 40, 0, 48, Math.PI, new THREE.Vector3(1.8, 1.15, 1.15));
    place(asset, 0, 0, 24, -Math.PI / 2, new THREE.Vector3(1.8, 1.15, 1.15));
    place(asset, 80, 0, 24, Math.PI / 2, new THREE.Vector3(1.8, 1.15, 1.15));
  });

  load("/models/arena-dungeon/pillar.glb", (asset) => {
    prepare(asset, false);
    for (const pillar of PILLARS)
      place(
        asset,
        pillar.x / 25,
        0,
        pillar.y / 25,
        Math.PI / 4,
        new THREE.Vector3(4.65, 1.72, 4.65),
      );
  });

  return () => {
    disposed = true;
  };
}
