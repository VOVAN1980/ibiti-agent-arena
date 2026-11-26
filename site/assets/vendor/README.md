# Vendored files

Copies kept with the site, so the fight page does not depend on a third-party CDN being up.
They are served as they are; nothing here is edited.

| Path | What | Source | License |
| --- | --- | --- | --- |
| `three/build/three.module.js` | three.js 0.160.0 | `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js` | MIT, see `three/LICENSE` |
| `three/examples/jsm/…` | the three.js add-ons the arena uses (post-processing, GLTF loader, skeleton utils, rounded box, room environment) and the add-ons they import | `https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/…` | MIT, see `three/LICENSE` |

The robots' skeleton, rest pose and the idle and walk clips (`../arena/models/robot-*.glb`,
`robot-moves.glb`) come from the X Bot character from Mixamo (Adobe), as shipped with the three.js
r160 examples; Mixamo characters are royalty free for personal, commercial and non-profit projects
(Adobe Mixamo FAQ). The armour on them is our own.

To add another add-on, copy it from the same three.js version (and whatever it imports) into the
same place under `three/examples/jsm/`. The import map in `match.html` points `three` and
`three/addons/` here.
