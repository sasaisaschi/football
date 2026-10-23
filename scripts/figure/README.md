# Footballer figure

`public/models/footballer.glb` is built by `build-footballer.py` from **Blender "Human Base Meshes" v1.4.1** (Blender Foundation and community contributors, **CC0 1.0** public domain dedication): <https://www.blender.org/download/demo-files/> → Asset Bundles → Human Base Meshes, file `human-base-meshes-bundle-v1.4.1.zip` (mirror: `https://mirror.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip`).

Used object: `GEO-body_male_realistic` (base resolution, multires detail not applied) and its two eyes. No likeness of a real person, no club or league material.

What the script does, reproducibly:
1. copies the mesh and eyes, centres them (feet on z = 0, facing −y),
2. reduces to ≈ 11 700 triangles (Decimate 0.5),
3. adds a 17-bone skeleton (pelvis, spine, chest, neck, head; thigh, shin, foot, upper arm, forearm, hand per side) at joint positions read off front and side renders, and binds it with automatic weights,
4. stores the body part per vertex (vertex colour R) and lets cloth and hair stand off the skin (shirt 11 mm, shorts 16–28 mm flaring to the hem, socks 5 mm, boots 9 mm, hair 9 mm),
5. exports a skinned glTF without animations or materials.

The kit colours are applied in the game's shader (`src/render/footballer.ts`), which also poses the skeleton from the physics every frame.

```bash
blender -b <bundle>/human_base_meshes_bundle.blend --python scripts/figure/build-footballer.py -- public/models/footballer.glb [preview-dir]
```
