#!/usr/bin/env python3
"""
Export the SimReady Residence architectural layout and all placed
NVIDIA SimReady assets as a composed OpenUSD scene (home_scene.usda).
"""

from __future__ import annotations

import json
from pathlib import Path
from pxr import Gf, Sdf, Usd, UsdGeom

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "public" / "models" / "manifest.json"
OUT_USDA = ROOT / "home_scene.usda"


def export_usda(placements: list[dict]) -> Path:
    manifest = json.loads(MANIFEST_PATH.read_text()) if MANIFEST_PATH.exists() else {}
    stage = Usd.Stage.CreateNew(str(OUT_USDA))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)

    root = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(root.GetPrim())

    arch_scope = UsdGeom.Scope.Define(stage, "/World/Architecture")
    floor = UsdGeom.Cube.Define(stage, "/World/Architecture/MainFloorSlab")
    floor.GetSizeAttr().Set(1.0)
    UsdGeom.Xformable(floor).AddScaleOp().Set(Gf.Vec3f(14.2, 0.14, 10.2))
    UsdGeom.Xformable(floor).AddTranslateOp().Set(Gf.Vec3d(0.0, -0.07, 0.0))

    furn_scope = UsdGeom.Scope.Define(stage, "/World/SimReadyFurnishings")

    for idx, item in enumerate(placements):
        aid = item["assetId"]
        meta = manifest.get(aid, {})
        dims = meta.get("dimensions_m", [0.5, 0.5, 0.5])
        safe_name = f"Item_{idx:03d}_{aid}".replace("-", "_")
        prim_path = f"/World/SimReadyFurnishings/{safe_name}"
        xf = UsdGeom.Xform.Define(stage, prim_path)

        pos = item.get("pos", [0.0, 0.0, 0.0])
        rot_y_deg = item.get("rotYDeg", 0.0)
        scale = item.get("scale", [1.0, 1.0, 1.0])

        xf.AddTranslateOp().Set(Gf.Vec3d(float(pos[0]), float(pos[1]), float(pos[2])))
        if abs(rot_y_deg) > 1e-4:
            xf.AddRotateYOp().Set(float(rot_y_deg))
        if scale != [1.0, 1.0, 1.0]:
            xf.AddScaleOp().Set(Gf.Vec3f(float(scale[0]), float(scale[1]), float(scale[2])))

        # Record authentic NVIDIA SimReady provenance metadata on prim
        p = xf.GetPrim()
        p.SetCustomDataByKey("simready:asset_id", aid)
        p.SetCustomDataByKey("simready:room", item.get("room", "Home"))
        p.SetCustomDataByKey("simready:label", item.get("label", aid))
        p.SetCustomDataByKey("simready:huggingface_dataset", "https://huggingface.co/datasets/nvidia/simready-assets")
        if meta.get("package_id"):
            p.SetCustomDataByKey("simready:package_id", meta["package_id"])
        if meta.get("mass_kg") is not None:
            p.SetCustomDataByKey("simready:mass_kg", meta["mass_kg"])

        # Add bounding-box proxy geometry with extent matching SimReady dimensions
        proxy = UsdGeom.Cube.Define(stage, f"{prim_path}/SimReadyBoundsProxy")
        proxy.GetSizeAttr().Set(1.0)
        pxf = UsdGeom.Xformable(proxy)
        pxf.AddTranslateOp().Set(Gf.Vec3d(0.0, float(dims[1]) * 0.5, 0.0))
        pxf.AddScaleOp().Set(Gf.Vec3f(float(dims[0]), float(dims[1]), float(dims[2])))

    stage.GetRootLayer().Save()
    return OUT_USDA


if __name__ == "__main__":
    layout_file = ROOT / "src" / "house" / "layout_data.json"
    if layout_file.exists():
        data = json.loads(layout_file.read_text())
        out = export_usda(data)
        print("Exported OpenUSD scene:", out)
    else:
        print("No src/house/layout_data.json found yet.")
