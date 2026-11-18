# SimReady Residence — Interactive 3D Home Explorer

An interactive WebGL walkthrough of a fully furnished modern residence built with open-source OpenUSD assets from [nvidia/simready-assets](https://huggingface.co/datasets/nvidia/simready-assets) (`CC-BY-4.0`), converted to compact PBR `.glb` models with extracted SimReady physics and semantic metadata.

## Exploring the Home

- **Walk Mode (`WASD` / Arrow keys, `Shift` to sprint):** Drag to look around (or double-click the canvas for Pointer Lock FPS mode). Wall and furniture colliders keep movement smooth through doorways.
- **Orbit / Dollhouse Mode (`V`) & Cutaway (`C`):** Switch to orbital camera and toggle the roof/ceiling off to view the entire floorplan from above.
- **Room Teleport (`1`–`6` or toolbar / minimap):** Jump directly to **Living Room**, **Kitchen & Dining**, **Home Office**, **Primary Bedroom**, **Bathroom**, or **Sun Deck & Entry**.
- **Asset Inspector & Doors:** Click any piece of furniture, appliance, or decor to view its NVIDIA SimReady dimensions, mass, friction/density properties, validation profile, and semantic labels. Click wooden interior/front doors to swing them open or closed.
- **Lighting Modes (`L`):** Cycle between **Daylight**, **Golden Hour**, and **Warm Evening**.

## Local Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
npm run preview
```

## Regenerating Assets from OpenUSD (Optional)

Pre-converted PBR `.glb` models and metadata are stored in `public/models/`. To re-fetch and convert the source OpenUSD assets from Hugging Face:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/build_assets.py
python scripts/export_home_usda.py
```

## Attribution

3D furniture, appliances, fixtures, and decor models are derived from [NVIDIA SimReady Assets](https://huggingface.co/datasets/nvidia/simready-assets) licensed under **CC-BY-4.0**.
