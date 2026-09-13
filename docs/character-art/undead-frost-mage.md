# Undead Frost Mage character contract

Reference: [undead-frost-mage-model-sheet.png](./undead-frost-mage-model-sheet.png)

This character establishes the shared scale, skeleton, and animation contract for
arena combatants. The current Three.js mesh is an animated proxy built from this
sheet; a production sculpt can replace it without changing simulation code.

## Mesh budget and materials

- One skinned humanoid mesh, 15k–25k triangles at LOD0.
- One 2k texture set: base color, ORM, normal, and emissive.
- Separate staff mesh parented to `hand_r`; frost crystal uses emissive cyan.
- No floor-length cloth. Mantle and split tunic must deform cleanly during running,
  jumping, and casting.
- Character height in the exported scene: 2.4 units from sole to hair.
- Origin centered between the feet at ground level; forward is positive Z.

## Required skeleton and sockets

Use a conventional humanoid hierarchy with hips, spine, chest, neck, head,
clavicles, upper/lower arms, hands, upper/lower legs, and feet. Add these sockets:

- `spell_hand_l`
- `spell_hand_r`
- `spell_origin` at upper chest height
- `status_overhead` above the head
- `weapon_socket_r`

Skin and staff must share one root transform. Apply transforms before export.

## Required animation clips

| Clip | Loop | Notes |
| --- | --- | --- |
| `Idle` | yes | Subtle hunched breathing, staff planted |
| `RunForward` | yes | Readable at the current chase-camera distance |
| `StrafeLeft` | yes | Feet and torso remain combat-facing |
| `StrafeRight` | yes | Mirrored timing is acceptable |
| `JumpStart` | no | Anticipation and takeoff |
| `JumpLoop` | yes | Compact airborne pose |
| `JumpLand` | no | Short recovery |
| `CastStart` | no | Hands gather toward the spell origin |
| `CastLoop` | yes | Supports arbitrary cast duration |
| `CastRelease` | no | Clear forward release from both hands |
| `Hit` | no | Brief readable impact |
| `Stun` | yes | Rigid off-balance pose |
| `FearRun` | yes | Panicked run while retaining locomotion |
| `Death` | no | Ends in a stable floor pose |

## GLB delivery

Export as `undead-frost-mage.glb` with mesh, skeleton, staff, materials, and all
clips embedded. Do not bake lights, cameras, environment geometry, or gameplay
effects. Use linear interpolation only where stepped keys are intentional.
