# Arena dungeon environment

The arena presentation shell uses selected GLB modules from Kenney's
[Modular Dungeon Kit](https://kenney.nl/assets/modular-dungeon-kit), released
under CC0. The source license is preserved at
[`docs/licenses/kenney-modular-dungeon-kit.txt`](../licenses/kenney-modular-dungeon-kit.txt).

The authored modules provide alternating stone floor tiles, perimeter wall
variation, four barred gates, and two solid carved arena pillars. Their transforms
are presentation-only. Server simulation geometry in
`packages/simulation` remains authoritative for movement, line of sight, and
camera collision.

The procedural environment beneath the GLB shell is intentionally retained as
an invisible collision and loading fallback. New visual layouts must continue to
communicate those footprints accurately unless the shared simulation geometry is
changed at the same time.
