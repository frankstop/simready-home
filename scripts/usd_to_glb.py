#!/usr/bin/env python3
"""
Convert an NVIDIA SimReady OpenUSD asset directory into a compact, web-ready GLB
with PBR textures (Albedo, ORM, Normal), optional UV-preserving mesh decimation,
and extracted SimReady physics/semantic metadata.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
from pathlib import Path
from typing import Any

import fast_simplification
import numpy as np
from PIL import Image
from pxr import Usd, UsdGeom, UsdPhysics, UsdShade
import pygltflib


def _is_hidden_or_collision(prim: Usd.Prim) -> bool:
    path_str = str(prim.GetPath()).lower()
    for token in ("collid", "collision", "physics", "proxy", "guide"):
        if token in path_str:
            return True
    if prim.IsA(UsdGeom.Imageable):
        img = UsdGeom.Imageable(prim)
        purpose = img.ComputePurpose()
        if purpose in (UsdGeom.Tokens.guide, UsdGeom.Tokens.proxy):
            return True
        if img.ComputeVisibility() == UsdGeom.Tokens.invisible:
            return True
    return False


def _usd_to_gltf_vec3(v: np.ndarray, up_axis: str, scale: float) -> np.ndarray:
    out = v.astype(np.float32) * float(scale)
    if up_axis == "Z":
        res = np.empty_like(out)
        res[:, 0] = out[:, 0]
        res[:, 1] = out[:, 2]
        res[:, 2] = -out[:, 1]
        return res
    return out


def _usd_to_gltf_dir3(v: np.ndarray, up_axis: str) -> np.ndarray:
    out = v.astype(np.float32)
    if up_axis == "Z":
        res = np.empty_like(out)
        res[:, 0] = out[:, 0]
        res[:, 1] = out[:, 2]
        res[:, 2] = -out[:, 1]
        return res
    return out


def _resolve_shader_input(shader: UsdShade.Shader, input_name: str):
    inp = shader.GetInput(input_name)
    if not inp:
        return None, None
    sources = inp.GetConnectedSources()
    if sources and sources[0]:
        src = sources[0][0]
        return UsdShade.Shader(src.source.GetPrim()), src.sourceName
    return inp.Get(), None


def _extract_uv_transform(tex_shader: UsdShade.Shader) -> tuple[tuple[float, float], float, tuple[float, float], str]:
    scale = (1.0, 1.0)
    rotation = 0.0
    translation = (0.0, 0.0)
    varname = "st"

    st_val, _ = _resolve_shader_input(tex_shader, "st")
    if isinstance(st_val, UsdShade.Shader):
        sid = st_val.GetShaderId()
        if sid == "UsdTransform2d":
            s = st_val.GetInput("scale").Get()
            if s is not None:
                scale = (float(s[0]), float(s[1]))
            r = st_val.GetInput("rotation").Get()
            if r is not None:
                rotation = float(r)
            t = st_val.GetInput("translation").Get()
            if t is not None:
                translation = (float(t[0]), float(t[1]))
            in_val, _ = _resolve_shader_input(st_val, "in")
            if isinstance(in_val, UsdShade.Shader):
                vn = in_val.GetInput("varname").Get()
                if vn:
                    varname = str(vn)
        elif sid == "UsdPrimvarReader_float2":
            vn = st_val.GetInput("varname").Get()
            if vn:
                varname = str(vn)
    return scale, rotation, translation, varname


def _extract_material_info(mat_prim: Usd.Prim) -> dict[str, Any]:
    mat = UsdShade.Material(mat_prim)
    info: dict[str, Any] = {
        "name": mat_prim.GetName(),
        "base_color": [1.0, 1.0, 1.0, 1.0],
        "metallic": 0.0,
        "roughness": 0.5,
        "emissive": [0.0, 0.0, 0.0],
        "albedo_path": None,
        "orm_path": None,
        "normal_path": None,
        "emissive_path": None,
        "uv_scale": (1.0, 1.0),
        "uv_rotation": 0.0,
        "uv_translation": (0.0, 0.0),
        "uv_varname": "st",
        "double_sided": False,
        "alpha_mode": "OPAQUE",
    }

    surf = mat.ComputeSurfaceSource()
    surf_shader = surf[0] if surf else None
    if surf_shader:
        diff_val, _ = _resolve_shader_input(surf_shader, "diffuseColor")
        if isinstance(diff_val, UsdShade.Shader):
            f_inp = diff_val.GetInput("file")
            if f_inp and f_inp.Get():
                resolved = f_inp.Get().resolvedPath
                if resolved and os.path.exists(resolved):
                    info["albedo_path"] = resolved
            sc_inp = diff_val.GetInput("scale")
            if sc_inp and sc_inp.Get() is not None:
                sc = sc_inp.Get()
                info["base_color"] = [float(sc[0]), float(sc[1]), float(sc[2]), 1.0]
            uv_s, uv_r, uv_t, uv_v = _extract_uv_transform(diff_val)
            info["uv_scale"] = uv_s
            info["uv_rotation"] = uv_r
            info["uv_translation"] = uv_t
            info["uv_varname"] = uv_v
        elif diff_val is not None:
            info["base_color"] = [float(diff_val[0]), float(diff_val[1]), float(diff_val[2]), 1.0]

        op_val, _ = _resolve_shader_input(surf_shader, "opacity")
        if isinstance(op_val, (int, float)):
            op = float(op_val)
            info["base_color"][3] = op
            if op < 0.99:
                info["alpha_mode"] = "BLEND"
                info["double_sided"] = True

        met_val, _ = _resolve_shader_input(surf_shader, "metallic")
        if isinstance(met_val, UsdShade.Shader):
            f_inp = met_val.GetInput("file")
            if f_inp and f_inp.Get():
                resolved = f_inp.Get().resolvedPath
                if resolved and os.path.exists(resolved):
                    info["orm_path"] = resolved
                    info["metallic"] = 1.0
        elif isinstance(met_val, (int, float)):
            info["metallic"] = float(met_val)

        rough_val, _ = _resolve_shader_input(surf_shader, "roughness")
        if isinstance(rough_val, UsdShade.Shader):
            f_inp = rough_val.GetInput("file")
            if f_inp and f_inp.Get():
                resolved = f_inp.Get().resolvedPath
                if resolved and os.path.exists(resolved):
                    info["orm_path"] = resolved
                    info["roughness"] = 1.0
        elif isinstance(rough_val, (int, float)):
            info["roughness"] = float(rough_val)

        norm_val, _ = _resolve_shader_input(surf_shader, "normal")
        if isinstance(norm_val, UsdShade.Shader):
            f_inp = norm_val.GetInput("file")
            if f_inp and f_inp.Get():
                resolved = f_inp.Get().resolvedPath
                if resolved and os.path.exists(resolved):
                    info["normal_path"] = resolved

        em_val, _ = _resolve_shader_input(surf_shader, "emissiveColor")
        if isinstance(em_val, UsdShade.Shader):
            f_inp = em_val.GetInput("file")
            if f_inp and f_inp.Get():
                resolved = f_inp.Get().resolvedPath
                if resolved and os.path.exists(resolved):
                    info["emissive_path"] = resolved
                    info["emissive"] = [1.0, 1.0, 1.0]
        elif em_val is not None:
            info["emissive"] = [float(em_val[0]), float(em_val[1]), float(em_val[2])]

    # Fallback / supplemental properties from OmniPBR shader if UsdPreviewSurface lacked them
    for child in mat_prim.GetChildren():
        if child.IsA(UsdShade.Shader) and "omnipbr" in child.GetName().lower():
            omni = UsdShade.Shader(child)
            em_int = omni.GetInput("emissive_intensity")
            em_col = omni.GetInput("emissive_color")
            if em_int and em_int.Get() and float(em_int.Get()) > 0.0:
                ec = em_col.Get() if (em_col and em_col.Get()) else (1.0, 1.0, 1.0)
                scale_e = min(float(em_int.Get()), 1.0)
                info["emissive"] = [float(ec[0]) * scale_e, float(ec[1]) * scale_e, float(ec[2]) * scale_e]
            if info["albedo_path"] is None:
                dt = omni.GetInput("diffuse_texture")
                if dt and dt.Get():
                    r = dt.Get().resolvedPath
                    if r and os.path.exists(r):
                        info["albedo_path"] = r
                        ts = omni.GetInput("texture_scale")
                        if ts and ts.Get():
                            info["uv_scale"] = (float(ts.Get()[0]), float(ts.Get()[1]))
            if info["albedo_path"] is None and info["base_color"][:3] == [1.0, 1.0, 1.0]:
                dc = omni.GetInput("diffuse_color_constant")
                if dc and dc.Get() is not None:
                    c = dc.Get()
                    info["base_color"] = [float(c[0]), float(c[1]), float(c[2]), info["base_color"][3]]
            if info["orm_path"] is None:
                ot = omni.GetInput("ORM_texture")
                if ot and ot.Get():
                    r = ot.Get().resolvedPath
                    if r and os.path.exists(r):
                        info["orm_path"] = r
                        info["roughness"] = 1.0
                        info["metallic"] = 1.0
            if info["normal_path"] is None:
                nt = omni.GetInput("normalmap_texture")
                if nt and nt.Get():
                    r = nt.Get().resolvedPath
                    if r and os.path.exists(r):
                        info["normal_path"] = r

    lname = info["name"].lower()
    if "leaf" in lname or "plant" in lname or "foliage" in lname or "dried" in lname:
        info["double_sided"] = True
    if "clear_glass" in lname or "clearglass" in lname or ("glass" in lname and "vase" not in lname and "glossy" not in lname):
        if info["alpha_mode"] == "OPAQUE" and info["base_color"][3] >= 0.99:
            info["base_color"] = [0.85, 0.92, 0.96, 0.30]
            info["alpha_mode"] = "BLEND"
            info["roughness"] = 0.06
            info["metallic"] = 0.05
            info["double_sided"] = True

    return info


def _encode_texture(path: str, max_size: int, kind: str) -> tuple[bytes, str, bool]:
    with Image.open(path) as im:
        has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        if has_alpha and kind == "albedo":
            alpha_extrema = im.convert("RGBA").getchannel("A").getextrema()
            has_alpha = alpha_extrema[0] < 252
        else:
            has_alpha = False

        w, h = im.size
        cap = max_size if kind == "albedo" else min(max_size, 512)
        if max(w, h) > cap:
            ratio = cap / float(max(w, h))
            nw = max(1, int(round(w * ratio)))
            nh = max(1, int(round(h * ratio)))
            im = im.resize((nw, nh), Image.Resampling.LANCZOS)

        buf = io.BytesIO()
        if kind == "albedo":
            if has_alpha:
                im.convert("RGBA").save(buf, format="PNG", optimize=True)
                return buf.getvalue(), "image/png", True
            im.convert("RGB").save(buf, format="JPEG", quality=85, optimize=True)
            return buf.getvalue(), "image/jpeg", False
        if kind == "normal":
            im.convert("RGB").save(buf, format="JPEG", quality=92, optimize=True)
            return buf.getvalue(), "image/jpeg", False
        # ORM: RGB PNG at <=512px preserves exact metallic/roughness/AO channels cleanly and compactly
        im.convert("RGB").save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "image/png", False


def _get_primvar_data(mesh: UsdGeom.Mesh, varname: str, fvc: np.ndarray, fvi: np.ndarray):
    pv = UsdGeom.PrimvarsAPI(mesh).GetPrimvar(varname)
    if not pv or not pv.HasValue():
        for alt in ("st", "st0", "uv", "UVMap"):
            if alt != varname:
                pv = UsdGeom.PrimvarsAPI(mesh).GetPrimvar(alt)
                if pv and pv.HasValue():
                    break
    if not pv or not pv.HasValue():
        return None

    vals = np.asarray(pv.Get(), dtype=np.float32)
    if vals.ndim != 2 or vals.shape[1] < 2:
        return None
    vals = vals[:, :2]
    interp = pv.GetInterpolation()
    indices = pv.GetIndices() if pv.IsIndexed() else None
    total_corners = int(fvc.sum())

    if interp == UsdGeom.Tokens.faceVarying:
        if indices is not None:
            return vals[np.asarray(indices, dtype=np.int64)]
        if len(vals) == total_corners:
            return vals
    elif interp in (UsdGeom.Tokens.vertex, UsdGeom.Tokens.varying):
        if indices is not None:
            vals = vals[np.asarray(indices, dtype=np.int64)]
        return vals[fvi]
    elif interp == UsdGeom.Tokens.uniform:
        if indices is not None:
            vals = vals[np.asarray(indices, dtype=np.int64)]
        return np.repeat(vals, fvc, axis=0)
    elif interp == UsdGeom.Tokens.constant:
        return np.repeat(vals[:1], total_corners, axis=0)
    return None


def _get_normals_per_corner(mesh: UsdGeom.Mesh, pts: np.ndarray, fvc: np.ndarray, fvi: np.ndarray) -> np.ndarray | None:
    n_attr = mesh.GetNormalsAttr()
    if n_attr and n_attr.HasValue():
        vals = np.asarray(n_attr.Get(), dtype=np.float32)
        if len(vals) > 0:
            interp = mesh.GetNormalsInterpolation()
            total_corners = int(fvc.sum())
            if interp == UsdGeom.Tokens.faceVarying and len(vals) == total_corners:
                return vals
            if interp in (UsdGeom.Tokens.vertex, UsdGeom.Tokens.varying) and len(vals) == len(pts):
                return vals[fvi]
            if interp == UsdGeom.Tokens.uniform and len(vals) == len(fvc):
                return np.repeat(vals, fvc, axis=0)

    pn = UsdGeom.PrimvarsAPI(mesh).GetPrimvar("normals")
    if pn and pn.HasValue():
        vals = np.asarray(pn.Get(), dtype=np.float32)
        interp = pn.GetInterpolation()
        idx = pn.GetIndices() if pn.IsIndexed() else None
        if interp == UsdGeom.Tokens.faceVarying:
            return vals[np.asarray(idx, dtype=np.int64)] if idx is not None else vals
        if interp in (UsdGeom.Tokens.vertex, UsdGeom.Tokens.varying):
            if idx is not None:
                vals = vals[np.asarray(idx, dtype=np.int64)]
            return vals[fvi]
    return None


def _apply_uv_transform(uv: np.ndarray, scale: tuple[float, float], rot_deg: float, trans: tuple[float, float]) -> np.ndarray:
    u = uv[:, 0].copy()
    v = uv[:, 1].copy()
    sx, sy = scale
    tx, ty = trans
    u *= sx
    v *= sy
    if abs(rot_deg) > 1e-5:
        rad = math.radians(rot_deg)
        c, s = math.cos(rad), math.sin(rad)
        u, v = u * c - v * s, u * s + v * c
    u += tx
    v += ty
    out = np.empty_like(uv)
    out[:, 0] = u
    out[:, 1] = 1.0 - v
    return out


def _decimate_primitive(
    u_pos: np.ndarray,
    u_norm: np.ndarray,
    u_uv: np.ndarray,
    indices: np.ndarray,
    target_tris: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    tris = indices.reshape(-1, 3).astype(np.int32)
    n_tris = len(tris)
    if n_tris <= target_tris or n_tris < 400:
        return u_pos, u_norm, u_uv, indices

    # Attempt border-preserving simplification first to keep UV seams crisp
    p2, t2, col = fast_simplification.simplify(
        u_pos.astype(np.float64),
        tris,
        target_count=target_tris,
        agg=6.5,
        return_collapses=True,
        preserve_border=True,
    )
    # If disconnected sub-parts / foliage cards prevented reduction, allow border simplification
    if len(t2) > max(int(target_tris * 1.5), 4000):
        p2, t2, col = fast_simplification.simplify(
            u_pos.astype(np.float64),
            tris,
            target_count=target_tris,
            agg=7.5,
            return_collapses=True,
            preserve_border=False,
        )

    if len(t2) >= n_tris or len(t2) == 0:
        return u_pos, u_norm, u_uv, indices

    _, _, idx_map = fast_simplification.replay_simplification(u_pos.astype(np.float32), tris, col)
    valid = idx_map >= 0
    v_idx = np.flatnonzero(valid)
    mapped_j = idx_map[v_idx]
    # Note: replay_simplification drops vertices not referenced by dec_triangles; check range
    if len(v_idx) == 0 or int(mapped_j.max()) >= len(p2):
        return u_pos, u_norm, u_uv, indices

    d2 = np.sum((u_pos[v_idx] - p2[mapped_j]) ** 2, axis=1)
    order_pick = np.lexsort((d2, mapped_j))
    sorted_j = mapped_j[order_pick]
    uniq_j, first_pos = np.unique(sorted_j, return_index=True)

    if len(uniq_j) != len(p2):
        # Safety fallback: map every vertex in p2 to nearest original vertex by cluster or fallback
        best_orig = np.zeros(len(p2), dtype=np.int64)
        best_orig[uniq_j] = v_idx[order_pick[first_pos]]
        missing = np.setdiff1d(np.arange(len(p2)), uniq_j)
        for mj in missing:
            best_orig[mj] = int(np.argmin(np.sum((u_pos - p2[mj]) ** 2, axis=1)))
    else:
        best_orig = v_idx[order_pick[first_pos]]

    new_pos = p2.astype(np.float32)
    new_norm = u_norm[best_orig].astype(np.float32)
    new_uv = u_uv[best_orig].astype(np.float32)
    new_indices = t2.reshape(-1).astype(np.uint32)
    return new_pos, new_norm, new_uv, new_indices


def _pad4(data: bytes) -> bytes:
    rem = len(data) % 4
    return data + (b"\x00" * (4 - rem) if rem else b"")


def _extract_simready_metadata(stage: Usd.Stage, asset_dir: Path) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "asset_id": asset_dir.name,
        "license": "CC-BY-4.0",
        "asset_type": "prop",
        "validation_profile": None,
        "semantic_labels": [],
        "physics_materials": [],
        "mass_kg": None,
    }
    pkg_json = asset_dir / "com.nvidia.simready.packaging.json"
    if pkg_json.exists():
        try:
            d = json.loads(pkg_json.read_text())
            meta["license"] = d.get("license", "CC-BY-4.0")
            meta["package_id"] = d.get("package_id")
        except Exception:
            pass

    base_usda = asset_dir / "simready_usd" / "payloads" / "base.usda"
    if base_usda.exists():
        try:
            bs = Usd.Stage.Open(str(base_usda))
            cld = bs.GetRootLayer().customLayerData
            sm = cld.get("SimReady_Metadata", {})
            if sm:
                meta["asset_type"] = sm.get("asset_type", "prop")
                val = sm.get("validation", {})
                if val:
                    meta["validation_profile"] = val.get("profile")
        except Exception:
            pass

    labels = set()
    phys_mats = []
    for prim in stage.Traverse(Usd.TraverseInstanceProxies()):
        for attr in prim.GetAttributes():
            name = attr.GetName()
            if name.startswith("semantics:labels:"):
                v = attr.Get()
                if v:
                    for item in v:
                        labels.add(str(item))
        if prim.IsA(UsdShade.Material) and "physics" in str(prim.GetPath()).lower():
            pm_info = {"name": prim.GetName()}
            for attr in prim.GetAttributes():
                an = attr.GetName()
                if an.startswith("pxr:usd:physics_") or an.startswith("physics:"):
                    val = attr.Get()
                    if isinstance(val, (int, float, str)):
                        pm_info[an.split(":")[-1].replace("physics_", "")] = round(val, 4) if isinstance(val, float) else val
            if len(pm_info) > 1:
                phys_mats.append(pm_info)
        if prim.HasAPI(UsdPhysics.MassAPI):
            m = UsdPhysics.MassAPI(prim).GetMassAttr().Get()
            if m is not None and m > 0:
                meta["mass_kg"] = round(float(m), 3)

    meta["semantic_labels"] = sorted(labels)
    meta["physics_materials"] = phys_mats[:4]
    return meta


def convert_usd_to_glb(
    usd_path: Path,
    glb_path: Path,
    max_tex_size: int = 512,
    max_tris: int = 24000,
    center_floor: bool = True,
) -> dict[str, Any]:
    stage = Usd.Stage.Open(str(usd_path))
    if not stage:
        raise RuntimeError(f"Failed to open USD stage: {usd_path}")

    up_axis = UsdGeom.GetStageUpAxis(stage)
    meters_per_unit = UsdGeom.GetStageMetersPerUnit(stage)
    xform_cache = UsdGeom.XformCache(Usd.TimeCode.Default())

    mat_cache: dict[str, dict[str, Any]] = {}
    primitives_by_mat: dict[str, list[dict[str, np.ndarray]]] = {}

    for prim in stage.Traverse(Usd.TraverseInstanceProxies()):
        if not prim.IsA(UsdGeom.Mesh) or _is_hidden_or_collision(prim):
            continue

        mesh = UsdGeom.Mesh(prim)
        pts_raw = mesh.GetPointsAttr().Get()
        fvc_raw = mesh.GetFaceVertexCountsAttr().Get()
        fvi_raw = mesh.GetFaceVertexIndicesAttr().Get()
        if pts_raw is None or fvc_raw is None or fvi_raw is None or len(pts_raw) == 0 or len(fvc_raw) == 0:
            continue

        pts = np.asarray(pts_raw, dtype=np.float64)
        fvc = np.asarray(fvc_raw, dtype=np.int64)
        fvi = np.asarray(fvi_raw, dtype=np.int64)

        world_mat = xform_cache.GetLocalToWorldTransform(prim)
        pts_h = np.hstack([pts, np.ones((len(pts), 1), dtype=np.float64)])
        mat_np = np.array(world_mat, dtype=np.float64)
        pts_world_usd = (pts_h @ mat_np)[:, :3]
        pts_world = _usd_to_gltf_vec3(pts_world_usd, up_axis, meters_per_unit)

        det = np.linalg.det(mat_np[:3, :3])
        is_left = mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded
        flip_winding = (det < 0) ^ is_left

        normals_local = _get_normals_per_corner(mesh, pts, fvc, fvi)
        if normals_local is not None:
            inv_t = np.linalg.inv(mat_np[:3, :3]).T
            n_world_usd = normals_local @ inv_t
            norms_corner = _usd_to_gltf_dir3(n_world_usd, up_axis)
            n_len = np.linalg.norm(norms_corner, axis=1, keepdims=True)
            norms_corner = np.divide(norms_corner, np.maximum(n_len, 1e-8))
        else:
            norms_corner = None

        num_faces = len(fvc)
        default_mat, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
        default_mat_key = str(default_mat.GetPath()) if default_mat else "__default__"
        if default_mat_key not in mat_cache:
            if default_mat:
                mat_cache[default_mat_key] = _extract_material_info(default_mat.GetPrim())
            else:
                mat_cache[default_mat_key] = {
                    "name": "default",
                    "base_color": [0.8, 0.8, 0.8, 1.0],
                    "metallic": 0.0,
                    "roughness": 0.5,
                    "emissive": [0.0, 0.0, 0.0],
                    "albedo_path": None,
                    "orm_path": None,
                    "normal_path": None,
                    "emissive_path": None,
                    "uv_scale": (1.0, 1.0),
                    "uv_rotation": 0.0,
                    "uv_translation": (0.0, 0.0),
                    "uv_varname": "st",
                    "double_sided": False,
                    "alpha_mode": "OPAQUE",
                }

        face_mat_paths = [default_mat_key] * num_faces
        for sub in UsdGeom.Subset.GetAllGeomSubsets(mesh):
            sub_prim = sub.GetPrim()
            if sub.GetElementTypeAttr().Get() != UsdGeom.Tokens.face:
                continue
            sub_mat, _ = UsdShade.MaterialBindingAPI(sub_prim).ComputeBoundMaterial()
            if not sub_mat:
                continue
            sub_key = str(sub_mat.GetPath())
            if sub_key not in mat_cache:
                mat_cache[sub_key] = _extract_material_info(sub_mat.GetPrim())
            sub_indices = sub.GetIndicesAttr().Get()
            if sub_indices is not None:
                for fi in sub_indices:
                    if 0 <= fi < num_faces:
                        face_mat_paths[int(fi)] = sub_key

        corner_starts = np.zeros(num_faces, dtype=np.int64)
        if num_faces > 1:
            corner_starts[1:] = np.cumsum(fvc[:-1])

        faces_by_mat: dict[str, list[int]] = {}
        for fi, mk in enumerate(face_mat_paths):
            faces_by_mat.setdefault(mk, []).append(fi)

        uv_cache: dict[str, np.ndarray | None] = {}
        for mk, face_list in faces_by_mat.items():
            minfo = mat_cache[mk]
            vname = minfo["uv_varname"]
            if vname not in uv_cache:
                uv_cache[vname] = _get_primvar_data(mesh, vname, fvc, fvi)
            raw_uv = uv_cache[vname]

            face_arr = np.asarray(face_list, dtype=np.int64)
            counts = fvc[face_arr]
            starts = corner_starts[face_arr]

            if np.all(counts == 3):
                c0 = starts
                c1 = starts + (2 if flip_winding else 1)
                c2 = starts + (1 if flip_winding else 2)
                tri_corners = np.stack([c0, c1, c2], axis=1).reshape(-1)
            else:
                tri_list = []
                for cnt, st_idx in zip(counts, starts):
                    if cnt < 3:
                        continue
                    for j in range(1, int(cnt) - 1):
                        if flip_winding:
                            tri_list.extend([st_idx, st_idx + j + 1, st_idx + j])
                        else:
                            tri_list.extend([st_idx, st_idx + j, st_idx + j + 1])
                if not tri_list:
                    continue
                tri_corners = np.asarray(tri_list, dtype=np.int64)

            p_indices = fvi[tri_corners]
            tri_pos = pts_world[p_indices]

            if norms_corner is not None:
                tri_norm = norms_corner[tri_corners]
            else:
                v0, v1, v2 = tri_pos[0::3], tri_pos[1::3], tri_pos[2::3]
                fn = np.cross(v1 - v0, v2 - v0)
                flen = np.linalg.norm(fn, axis=1, keepdims=True)
                fn = np.divide(fn, np.maximum(flen, 1e-8))
                tri_norm = np.repeat(fn, 3, axis=0).astype(np.float32)

            if raw_uv is not None:
                tri_uv = _apply_uv_transform(
                    raw_uv[tri_corners],
                    minfo["uv_scale"],
                    minfo["uv_rotation"],
                    minfo["uv_translation"],
                )
            else:
                tri_uv = np.zeros((len(tri_pos), 2), dtype=np.float32)

            primitives_by_mat.setdefault(mk, []).append({
                "pos": tri_pos.astype(np.float32),
                "norm": tri_norm.astype(np.float32),
                "uv": tri_uv.astype(np.float32),
            })

    if not primitives_by_mat:
        raise RuntimeError(f"No exportable mesh primitives found in {usd_path}")

    all_min = np.array([np.inf, np.inf, np.inf], dtype=np.float32)
    all_max = np.array([-np.inf, -np.inf, -np.inf], dtype=np.float32)
    raw_tris_by_mat: dict[str, int] = {}
    total_raw_tris = 0
    for mk, chunks in primitives_by_mat.items():
        mt = 0
        for ch in chunks:
            all_min = np.minimum(all_min, ch["pos"].min(axis=0))
            all_max = np.maximum(all_max, ch["pos"].max(axis=0))
            mt += len(ch["pos"]) // 3
        raw_tris_by_mat[mk] = mt
        total_raw_tris += mt

    offset = np.zeros(3, dtype=np.float32)
    if center_floor:
        offset[0] = -0.5 * (all_min[0] + all_max[0])
        offset[1] = -all_min[1]
        offset[2] = -0.5 * (all_min[2] + all_max[2])
        all_min = all_min + offset
        all_max = all_max + offset

    gltf = pygltflib.GLTF2(
        asset=pygltflib.Asset(version="2.0", generator="SimReady-USD-to-GLB"),
        scenes=[pygltflib.Scene(nodes=[0])],
        scene=0,
        nodes=[pygltflib.Node(mesh=0, name=usd_path.stem)],
        meshes=[pygltflib.Mesh(name=usd_path.stem, primitives=[])],
        buffers=[pygltflib.Buffer()],
        bufferViews=[],
        accessors=[],
        materials=[],
        textures=[],
        images=[],
        samplers=[
            pygltflib.Sampler(
                magFilter=pygltflib.LINEAR,
                minFilter=pygltflib.LINEAR_MIPMAP_LINEAR,
                wrapS=pygltflib.REPEAT,
                wrapT=pygltflib.REPEAT,
            )
        ],
    )

    bin_chunks: list[bytes] = []
    byte_offset = 0

    def append_bin(raw: bytes, target: int | None = None) -> int:
        nonlocal byte_offset
        raw_len = len(raw)
        padded = _pad4(raw)
        bv = pygltflib.BufferView(buffer=0, byteOffset=byte_offset, byteLength=raw_len)
        if target is not None:
            bv.target = target
        bv_idx = len(gltf.bufferViews)
        gltf.bufferViews.append(bv)
        bin_chunks.append(padded)
        byte_offset += len(padded)
        return bv_idx

    tex_index_cache: dict[tuple[str, str], int] = {}

    def get_or_add_texture(path: str | None, kind: str) -> int | None:
        if not path:
            return None
        key = (os.path.realpath(path), kind)
        if key in tex_index_cache:
            return tex_index_cache[key]
        raw_bytes, mime, _ = _encode_texture(path, max_tex_size, kind)
        bv_idx = append_bin(raw_bytes)
        img_idx = len(gltf.images)
        gltf.images.append(pygltflib.Image(bufferView=bv_idx, mimeType=mime))
        tex_idx = len(gltf.textures)
        gltf.textures.append(pygltflib.Texture(sampler=0, source=img_idx))
        tex_index_cache[key] = tex_idx
        return tex_idx

    total_tris = 0
    for mk, chunks in primitives_by_mat.items():
        minfo = mat_cache[mk]
        pos = np.concatenate([c["pos"] for c in chunks], axis=0)
        if center_floor:
            pos = pos + offset
        norm = np.concatenate([c["norm"] for c in chunks], axis=0)
        uv = np.concatenate([c["uv"] for c in chunks], axis=0)

        vert_struct = np.concatenate([pos, norm, uv], axis=1)
        _, uniq_first, inverse = np.unique(vert_struct, axis=0, return_index=True, return_inverse=True)
        order = np.argsort(uniq_first)
        inv_map = np.empty_like(order)
        inv_map[order] = np.arange(len(order))
        uniq_idx = uniq_first[order]
        indices = inv_map[inverse].astype(np.uint32)

        u_pos = pos[uniq_idx].astype(np.float32)
        u_norm = norm[uniq_idx].astype(np.float32)
        u_uv = uv[uniq_idx].astype(np.float32)

        # Decimate proportionally if total asset exceeds max_tris
        if max_tris > 0 and total_raw_tris > max_tris:
            prim_raw_tris = raw_tris_by_mat[mk]
            prim_target = max(400, int(round(max_tris * (prim_raw_tris / total_raw_tris))))
            u_pos, u_norm, u_uv, indices = _decimate_primitive(u_pos, u_norm, u_uv, indices, prim_target)

        total_tris += len(indices) // 3

        alb_tex = get_or_add_texture(minfo["albedo_path"], "albedo")
        orm_tex = get_or_add_texture(minfo["orm_path"], "orm")
        nor_tex = get_or_add_texture(minfo["normal_path"], "normal")
        em_tex = get_or_add_texture(minfo["emissive_path"], "albedo")

        pbr = pygltflib.PbrMetallicRoughness(
            baseColorFactor=minfo["base_color"],
            metallicFactor=minfo["metallic"],
            roughnessFactor=minfo["roughness"],
        )
        if alb_tex is not None:
            pbr.baseColorTexture = pygltflib.TextureInfo(index=alb_tex)
        if orm_tex is not None:
            pbr.metallicRoughnessTexture = pygltflib.TextureInfo(index=orm_tex)

        mat_obj = pygltflib.Material(
            name=minfo["name"],
            pbrMetallicRoughness=pbr,
            emissiveFactor=minfo["emissive"],
            alphaMode=minfo["alpha_mode"],
            doubleSided=minfo["double_sided"],
        )
        if orm_tex is not None:
            mat_obj.occlusionTexture = pygltflib.OcclusionTextureInfo(index=orm_tex, strength=0.85)
        if nor_tex is not None:
            mat_obj.normalTexture = pygltflib.NormalMaterialTexture(index=nor_tex, scale=1.0)
        if em_tex is not None:
            mat_obj.emissiveTexture = pygltflib.TextureInfo(index=em_tex)

        mat_idx = len(gltf.materials)
        gltf.materials.append(mat_obj)

        bv_pos = append_bin(u_pos.tobytes(), pygltflib.ARRAY_BUFFER)
        acc_pos = len(gltf.accessors)
        gltf.accessors.append(
            pygltflib.Accessor(
                bufferView=bv_pos,
                componentType=pygltflib.FLOAT,
                count=len(u_pos),
                type=pygltflib.VEC3,
                min=u_pos.min(axis=0).tolist(),
                max=u_pos.max(axis=0).tolist(),
            )
        )

        bv_norm = append_bin(u_norm.tobytes(), pygltflib.ARRAY_BUFFER)
        acc_norm = len(gltf.accessors)
        gltf.accessors.append(
            pygltflib.Accessor(
                bufferView=bv_norm,
                componentType=pygltflib.FLOAT,
                count=len(u_norm),
                type=pygltflib.VEC3,
            )
        )

        bv_uv = append_bin(u_uv.tobytes(), pygltflib.ARRAY_BUFFER)
        acc_uv = len(gltf.accessors)
        gltf.accessors.append(
            pygltflib.Accessor(
                bufferView=bv_uv,
                componentType=pygltflib.FLOAT,
                count=len(u_uv),
                type=pygltflib.VEC2,
            )
        )

        if len(u_pos) < 65535:
            idx_arr = indices.astype(np.uint16)
            idx_ctype = pygltflib.UNSIGNED_SHORT
        else:
            idx_arr = indices.astype(np.uint32)
            idx_ctype = pygltflib.UNSIGNED_INT

        bv_idx = append_bin(idx_arr.tobytes(), pygltflib.ELEMENT_ARRAY_BUFFER)
        acc_idx = len(gltf.accessors)
        gltf.accessors.append(
            pygltflib.Accessor(
                bufferView=bv_idx,
                componentType=idx_ctype,
                count=len(idx_arr),
                type=pygltflib.SCALAR,
            )
        )

        gltf.meshes[0].primitives.append(
            pygltflib.Primitive(
                attributes=pygltflib.Attributes(
                    POSITION=acc_pos,
                    NORMAL=acc_norm,
                    TEXCOORD_0=acc_uv,
                ),
                indices=acc_idx,
                material=mat_idx,
            )
        )

    gltf.buffers[0].byteLength = byte_offset
    gltf.set_binary_blob(b"".join(bin_chunks))
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    gltf.save_binary(str(glb_path))

    asset_dir = usd_path.parent.parent
    meta = _extract_simready_metadata(stage, asset_dir)
    dims = (all_max - all_min).tolist()
    meta["dimensions_m"] = [round(float(x), 3) for x in dims]
    meta["triangles"] = int(total_tris)
    meta["raw_triangles"] = int(total_raw_tris)
    meta["glb_size_kb"] = round(glb_path.stat().st_size / 1024.0, 1)
    meta["materials_count"] = len(gltf.materials)
    meta["textures_count"] = len(gltf.textures)
    return meta


def main():
    p = argparse.ArgumentParser()
    p.add_argument("usd_path", type=Path)
    p.add_argument("glb_path", type=Path)
    p.add_argument("--max-tex", type=int, default=512)
    p.add_argument("--max-tris", type=int, default=24000)
    p.add_argument("--no-center-floor", action="store_true")
    args = p.parse_args()
    meta = convert_usd_to_glb(args.usd_path, args.glb_path, args.max_tex, args.max_tris, not args.no_center_floor)
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
