import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import layoutData from './layout_data.json';

function enhanceSimReadyMaterials(assetId, root) {
  const isLamp = assetId.includes('lamp') || assetId.includes('ceilinglamp');
  const isMirror = assetId.includes('mirror');
  const isScreen = assetId === 'TV_a01' || assetId === 'computer_monitor_office_a01';

  root.traverse((child) => {
    if (!child.isMesh) return;
    const mat = child.material;
    const isTransparent = mat && (mat.transparent || mat.opacity < 0.99);
    child.castShadow = !isTransparent && !assetId.includes('rug') && !assetId.includes('doormat');
    child.receiveShadow = true;

    if (!mat) return;
    const mname = (mat.name || '').toLowerCase();

    if (isMirror && (mname.includes('mirror') || mname.includes('glass') || mname.includes('chrome'))) {
      mat.transparent = false;
      mat.opacity = 1.0;
      mat.depthWrite = true;
      mat.color.setHex(0xdbe2e8);
      mat.metalness = 0.95;
      mat.roughness = 0.05;
      mat.envMapIntensity = 1.6;
    } else if (mname.includes('m_trans__') || mname.startsWith('trans__')) {
      mat.transparent = true;
      mat.opacity = Math.min(mat.opacity || 1.0, 0.14);
      mat.roughness = 0.08;
      mat.depthWrite = false;
    }

    if (assetId === 'desk_a01' && (mname.includes('white') || mname.includes('wood') || mname.includes('laminate'))) {
      mat.roughness = Math.max(mat.roughness || 0.5, 0.52);
    }

    if (isLamp && (mname.includes('shade') || mname.includes('glass') || mname.includes('white') || mname.includes('emiss') || mname.includes('bulb') || mname.includes('plastic'))) {
      if (!mname.includes('metal') && !mname.includes('steel')) {
        mat.emissive = new THREE.Color(0xffe7bd);
        mat.emissiveIntensity = 0.55;
      }
    }

    if (isScreen && (mname.includes('glossy_black') || mname.includes('screen'))) {
      mat.roughness = 0.12;
      mat.metalness = 0.15;
    }
  });
}

export async function loadAndPlaceFurnishings(scene, arch, interactiveRoots, onProgress) {
  const manifestRes = await fetch('models/manifest.json');
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch models/manifest.json (${manifestRes.status})`);
  }
  const manifest = await manifestRes.json();

  const uniqueAssets = [...new Set(layoutData.map((item) => item.assetId))].filter((id) => manifest[id]);
  const loader = new GLTFLoader();
  const templateCache = new Map();

  let loadedCount = 0;
  const totalCount = uniqueAssets.length;
  onProgress(0, totalCount);

  // Load unique GLBs with bounded concurrency (6 at a time)
  const queue = [...uniqueAssets];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length > 0) {
      const aid = queue.shift();
      const entry = manifest[aid];
      try {
        const gltf = await loader.loadAsync(entry.glb_file);
        templateCache.set(aid, gltf.scene);
      } catch (err) {
        console.warn(`Could not load ${aid}:`, err);
      } finally {
        loadedCount += 1;
        onProgress(loadedCount, totalCount);
      }
    }
  });
  await Promise.all(workers);

  const furnishingsGroup = new THREE.Group();
  furnishingsGroup.name = 'SimReadyFurnishings';
  scene.add(furnishingsGroup);

  for (const item of layoutData) {
    const template = templateCache.get(item.assetId);
    const meta = manifest[item.assetId];
    if (!template || !meta) continue;

    const instance = template.clone(true);
    enhanceSimReadyMaterials(item.assetId, instance);

    const wrapper = new THREE.Group();
    wrapper.name = `${item.assetId}__${item.label}`;
    wrapper.position.set(item.pos[0], item.pos[1], item.pos[2]);
    wrapper.rotation.y = THREE.MathUtils.degToRad(item.rotYDeg || 0);
    if (item.scale) {
      wrapper.scale.set(item.scale[0], item.scale[1], item.scale[2]);
    }

    wrapper.userData.simreadyMeta = meta;
    wrapper.userData.placementInfo = {
      label: item.label,
      room: item.room,
      assetId: item.assetId,
    };

    wrapper.add(instance);
    if (item.assetId.startsWith('fixture_ceilinglamp_')) {
      arch.ceilingGroup.add(wrapper);
    } else {
      furnishingsGroup.add(wrapper);
    }
    interactiveRoots.push(wrapper);

    if (item.collide) {
      wrapper.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(wrapper);
      const pad = 0.14;
      arch.colliders.push({
        minX: box.min.x - pad,
        maxX: box.max.x + pad,
        minZ: box.min.z - pad,
        maxZ: box.max.z + pad,
      });
    }
  }

  return furnishingsGroup;
}
