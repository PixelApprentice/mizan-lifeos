# 3D device models

Procedural models used by the cinema demo film (`pnpm demo:cinema`), saved as binary glTF.
They open in Blender, three.js, Babylon.js, model-viewer and most 3D tools.

| File | Device | Size (real scale, metres) |
|---|---|---|
| `macbook-pro-14-space-black.glb` | 14" MacBook Pro style laptop, space black, lid open ~104° | 0.313 x 0.221 base |
| `macbook-pro-14-silver.glb` | Same, silver | |
| `iphone-18-pro-{silver,black,glacier,burgundy}.glb` | iPhone 18 Pro style phone | 0.072 x 0.150 x 0.009 |

- Each model has a mesh named `Screen`, a flat plane where you can put a texture or video. The laptop also has a `Lid` node that rotates about X at the hinge.
- Materials are PBR (metalness/roughness). The keyboard is a baked texture.
- Rebuild them with `pnpm demo:models`. The source is [`scripts/demo-video/trailer/devices.js`](../../scripts/demo-video/trailer/devices.js), so they always match the film.

They are original models built from published dimensions. They contain no Apple artwork or
logos, and the project is not affiliated with Apple. "MacBook Pro" and "iPhone" are Apple
trademarks and are used here only to describe what the models depict. The models are licensed
like the rest of the repository.
