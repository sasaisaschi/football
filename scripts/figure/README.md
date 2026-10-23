# Footballer figure

`public/models/footballer.glb` is built by `build-footballer.py` from **Blender "Human Base Meshes" v1.4.1** (Blender Foundation and community contributors, **CC0 1.0** public domain dedication): <https://www.blender.org/download/demo-files/> → Asset Bundles → Human Base Meshes, file `human-base-meshes-bundle-v1.4.1.zip` (mirror: `https://mirror.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip`).

Used object: `GEO-body_male_realistic` (base resolution, multires detail not applied) and its two eyes. No likeness of a real person, no club or league material.

What the script does, reproducibly:
1. copies the mesh and eyes, centres them (feet on z = 0, facing −y),
2. reduces to ≈ 11 700 triangles (Decimate 0.5),
3. adds a 17-bone skeleton (pelvis, spine, chest, neck, head; thigh, shin, foot, upper arm, forearm, hand per side) at joint positions read off front and side renders, and binds it with automatic weights,
4. stores the body part per vertex (vertex colour R) and lets cloth and hair stand off the skin (shirt 11 mm, shorts 16–28 mm flaring to the hem, socks 5 mm, boots 9 mm, hair 9 mm),
5. exports a skinned glTF without animations or materials.

## Motion (issue #39)

The model also carries seven motion clips retargeted from the **CMU Graphics Lab Motion Capture Database** (<http://mocap.cs.cmu.edu>; BVH conversion by Bruce Hahne, mirrored at <https://github.com/una-dinosauria/cmu-mocap>). Licence, from mocap.cs.cmu.edu: *"Use this data! This data is free for use in research and commercial projects worldwide."* The conversion adds no restriction (`READMEFIRST.txt`). Acknowledgement requested by CMU: *The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.*

| Clip | Source | Use |
| --- | --- | --- |
| `idle` | 10_01, frames 30–270 (actor waits before a kick) | standing |
| `walk` | 07_01, one stride cycle | 0–1.4 m/s |
| `jog` | 16_35, one stride cycle | 2.8 m/s |
| `run` | 09_01, one stride cycle | 3.5 m/s |
| `sprint` | 16_45, one stride cycle | 3.9 m/s and faster |
| `kickR`, `kickL` | 10_03 around the strike (36 frames before, 30 after), mirrored for the left foot | trunk, hips and arms while a boot swings |

`cmu_clips.py` retargets them: trunk bones by their rotation relative to the actor's T-pose, limbs by direction, turned so the actor moves towards the model's front, in place, hip height measured from the clip's own floor. The clip metadata (speed, stride, contact time) goes to `src/render/footballer-clips.json`.

```bash
node scripts/figure/fetch-cmu.mjs cmu-bvh
blender -b <bundle>/human_base_meshes_bundle.blend --python scripts/figure/build-footballer.py -- public/models/footballer.glb - cmu-bvh src/render/footballer-clips.json
```

The kit colours are applied in the game's shader (`src/render/footballer.ts`), which also poses the skeleton from the physics every frame.

```bash
blender -b <bundle>/human_base_meshes_bundle.blend --python scripts/figure/build-footballer.py -- public/models/footballer.glb [preview-dir]
```
