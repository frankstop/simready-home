#!/usr/bin/env python3
"""
Download selected residential assets from nvidia/simready-assets on Hugging Face,
convert them to compact GLBs with PBR textures, validate with trimesh,
and write public/models/manifest.json.
"""

from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
from usd_to_glb import convert_usd_to_glb

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "simready_usd_cache"
MODELS_DIR = ROOT / "public" / "models"
MANIFEST_PATH = MODELS_DIR / "manifest.json"

# (asset_id, max_tex_size, max_tris)
ASSET_SPECS: list[tuple[str, int, int]] = [
    # Hero Living / Bedroom / Kitchen Large Furniture
    ("furniture_couch_a01", 768, 22000),
    ("sofa_soft_b01", 768, 16000),
    ("sofa_soft_b02", 768, 18000),
    ("furniture_table_coffee_low_a01", 768, 12000),
    ("furniture_coffeeTable_a01", 768, 14000),
    ("textileDecor_rug_a01", 768, 6000),
    ("textileDecor_doormat_a01", 512, 4000),
    ("bedding_a01", 768, 20000),
    ("fixture_counter_a01", 768, 16000),
    ("fixture_island_a01", 768, 16000),
    ("appliance_refrigerator_twoDoor_a01", 512, 20000),
    ("desk_a01", 512, 12000),
    ("decor_plant_big_potted_c01", 512, 24000),

    # Medium Furniture / Fixtures / Appliances / Seating
    ("TV_a01", 512, 12000),
    ("fixture_cabinet_d01", 512, 12000),
    ("fixture_cabinet_b01", 512, 10000),
    ("fixture_cabinet_a01", 512, 10000),
    ("fixture_cabinet_pantry_a01", 512, 10000),
    ("fixture_cabinet_single_a01", 512, 10000),
    ("fixture_cabinet_top_a01", 512, 8000),
    ("fixture_cabinet_top_a02", 512, 8000),
    ("furniture_highstool_a01", 512, 10000),
    ("furniture_counter_coffeeStation_a01", 512, 14000),
    ("appliance_dishwasher_b01", 512, 14000),
    ("appliance_gasStove_table_a01", 512, 12000),
    ("appliance_stoveHood_a01", 512, 10000),
    ("fixture_sink_basin_b01", 512, 12000),
    ("fixture_faucet_stainless_a01", 512, 8000),
    ("chair_office_fabric_manager_a01", 512, 14000),
    ("chair_office_amf_black_a01", 512, 12000),
    ("storage_shelf_basic_a01", 512, 10000),
    ("toilet_a01", 512, 14000),
    ("washBasin_a01", 512, 10000),
    ("fauset_bathroom_a01", 512, 8000),
    ("mirror_bathroom_a01", 512, 4000),
    ("decor_mirror_a01", 512, 4000),
    ("decor_guitar_a01", 512, 12000),
    ("decor_painting_a01", 512, 4000),
    ("blinds_window_4m_open_a01", 512, 12000),
    ("blinds_window_2m_open_a01", 512, 10000),
    ("storage_bin_bamboo_a01", 512, 12000),
    ("bin_waste_a01", 512, 8000),

    # Small Props / Electronics / Kitchen / Decor / Lighting
    ("misc_speaker_a01", 384, 6000),
    ("decor_wallClock_a01", 384, 6000),
    ("decor_candleholder_a01", 384, 6000),
    ("magazines_stack_a01", 384, 4000),
    ("appliance_toaster_a01", 384, 6000),
    ("cookware_pan_copper_b02", 384, 6000),
    ("cookware_pot_copper_d01", 384, 6000),
    ("utensil_cuttingBoard_wooden_a01", 384, 3000),
    ("utensil_knife_set_a01", 384, 6000),
    ("grocery_bakery_croissant_a01", 384, 4000),
    ("food_banana_a01", 384, 3000),
    ("dishware_plate_a01", 384, 3000),
    ("dishware_bowl_a01", 384, 3000),
    ("dishware_mug_coffee_a01", 384, 4000),
    ("dishware_glass_wineRed_b01", 384, 4000),
    ("computer_monitor_office_a01", 512, 6000),
    ("computer_keyboard_a01", 384, 6000),
    ("computer_mouse_office_b01", 384, 4000),
    ("computer_desktop_tower_a01", 384, 6000),
    ("misc_headphones_a01", 384, 6000),
    ("trashCan_office_black_a03", 384, 3000),
    ("lamp_table_bedside_a01", 384, 6000),
    ("decor_photoFrame_a01", 384, 4000),
    ("decor_book_b02", 384, 3000),
    ("book_open_a01", 384, 5000),
    ("decor_candle_a01", 384, 3000),
    ("humidifier_a01", 384, 6000),
    ("fixture_toiletPaperHolder_double_a01", 384, 5000),
    ("cleaning_soapDispenser_a01", 384, 5000),
    ("cleaning_towel_folded_a01", 384, 5000),
    ("fixture_ceilinglamp_a01", 384, 5000),
    ("fixture_ceilinglamp_b01", 384, 5000),
    ("fixture_switch_a01", 384, 3000),
    ("fixture_socket_a01", 384, 3000),
    ("decor_vase_a01", 384, 4000),
    ("decor_plant_dried_vase_a01", 384, 12000),
]


def find_root_usd(asset_dir: Path) -> Path:
    root_json = asset_dir / ".metadata" / "com.nvidia.simready.root_usds.json"
    if root_json.exists():
        data = json.loads(root_json.read_text())
        entries = data.get("entries", [])
        if entries:
            cand = asset_dir / entries[0]
            if cand.exists():
                return cand
    sim_dir = asset_dir / "simready_usd"
    for ext in ("*.usda", "*.usd", "*.usdc"):
        cands = sorted(sim_dir.glob(ext))
        if cands:
            return cands[0]
    raise FileNotFoundError(f"No root USD found in {asset_dir}")


def main():
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, dict] = {}
    if MANIFEST_PATH.exists():
        try:
            manifest = json.loads(MANIFEST_PATH.read_text())
        except Exception:
            manifest = {}

    todo = []
    for asset_id, max_tex, max_tris in ASSET_SPECS:
        glb_path = MODELS_DIR / f"{asset_id}.glb"
        if glb_path.exists() and asset_id in manifest:
            continue
        todo.append((asset_id, max_tex, max_tris))

    print(f"Total specs: {len(ASSET_SPECS)}, Remaining to build: {len(todo)}", flush=True)
    batch_size = 8
    t_start = time.time()

    for idx in range(0, len(todo), batch_size):
        batch = todo[idx : idx + batch_size]
        batch_ids = [b[0] for b in batch]
        print(f"\n--- Batch {idx // batch_size + 1}: {batch_ids} ---", flush=True)

        snapshot_download(
            "nvidia/simready-assets",
            repo_type="dataset",
            local_dir=str(CACHE_DIR),
            allow_patterns=[f"{aid}/**" for aid in batch_ids],
            ignore_patterns=["*/source_assets/*", "*/.thumbs/*", "*/.simready/*", "*/runnables/*"],
        )

        for aid, max_tex, max_tris in batch:
            asset_dir = CACHE_DIR / aid
            glb_path = MODELS_DIR / f"{aid}.glb"
            try:
                root_usd = find_root_usd(asset_dir)
                meta = convert_usd_to_glb(root_usd, glb_path, max_tex_size=max_tex, max_tris=max_tris)
                # Validate with trimesh
                scene = trimesh.load(str(glb_path))
                if not hasattr(scene, "bounds") or scene.bounds is None:
                    raise RuntimeError("Invalid GLB bounds")
                meta["glb_file"] = f"models/{aid}.glb"
                manifest[aid] = meta
                MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))
                print(
                    f"  OK {aid:38s} dims={meta['dimensions_m']} tris={meta['triangles']:6d} size={meta['glb_size_kb']:6.1f}KB",
                    flush=True,
                )
            except Exception as exc:
                print(f"  ERR {aid}: {exc}", flush=True)
            finally:
                # Clean raw USD + 4K textures immediately after conversion to keep disk clean
                if glb_path.exists() and aid in manifest and asset_dir.exists():
                    shutil.rmtree(asset_dir, ignore_errors=True)

    # Clean up cache folder if empty
    if CACHE_DIR.exists():
        shutil.rmtree(CACHE_DIR, ignore_errors=True)

    total_kb = sum(m.get("glb_size_kb", 0) for m in manifest.values())
    total_tris = sum(m.get("triangles", 0) for m in manifest.values())
    print(f"\nDONE in {time.time() - t_start:.1f}s! Built {len(manifest)}/{len(ASSET_SPECS)} GLBs ({total_kb/1024:.1f} MB total, {total_tris:,} unique-asset tris).", flush=True)


if __name__ == "__main__":
    main()
