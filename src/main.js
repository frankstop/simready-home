import * as THREE from 'three';
import { buildHomeArchitecture } from './house/architecture.js';
import { setupLighting, LIGHTING_MODES, LIGHTING_LABELS } from './house/lighting.js';
import { loadAndPlaceFurnishings } from './house/furnishings.js';
import { createExplorerController } from './viewer/controls.js';
import { ROOM_VIEWPOINTS, detectRoomName, createMinimap } from './viewer/minimap.js';
import { initModernWebFallbacks, showAssetInspector } from './viewer/ui_helpers.js';

initModernWebFallbacks();

const canvas = document.getElementById('viewport-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.08, 120);

const lighting = setupLighting(renderer, scene);
const arch = buildHomeArchitecture(scene);
const explorer = createExplorerController(camera, canvas, arch.colliders);

// Initial viewpoint: Living Room looking across great room & kitchen
explorer.lookAtTarget(ROOM_VIEWPOINTS.living.walkPos, ROOM_VIEWPOINTS.living.walkTarget);

// UI elements
const roomLabelEl = document.getElementById('current-room-label');
const liveStatusEl = document.getElementById('live-status');
const loadingBanner = document.getElementById('loading-banner');
const loadingPct = document.getElementById('loading-pct');
const loadingProgress = document.getElementById('loading-progress');
const crosshair = document.getElementById('walk-crosshair');
const inspectorCard = document.getElementById('inspector-card');
const minimapPanel = document.getElementById('minimap-panel');
const btnWalk = document.getElementById('btn-mode-walk');
const btnOrbit = document.getElementById('btn-mode-orbit');
const btnCeiling = document.getElementById('btn-ceiling');
const btnLighting = document.getElementById('btn-lighting');
const btnMinimap = document.getElementById('btn-minimap');
const roomButtons = [...document.querySelectorAll('.room-btn')];

let ceilingVisible = true;
let lightingIdx = 0;
let minimapVisible = true;
let selectedGroup = null;
let selectionBox = null;

function announce(msg) {
  liveStatusEl.textContent = msg;
}

function setActiveRoomButton(roomId) {
  for (const btn of roomButtons) {
    btn.setAttribute('aria-pressed', btn.dataset.room === roomId ? 'true' : 'false');
  }
}

function jumpToRoom(roomId) {
  const vp = ROOM_VIEWPOINTS[roomId];
  if (!vp) return;
  setActiveRoomButton(roomId);
  explorer.teleportTo(vp, () => {
    roomLabelEl.textContent = vp.name;
    announce(`Moved to ${vp.name}`);
  });
}

function setMode(nextMode) {
  explorer.setMode(nextMode);
  btnWalk.setAttribute('aria-pressed', nextMode === 'walk' ? 'true' : 'false');
  btnOrbit.setAttribute('aria-pressed', nextMode === 'orbit' ? 'true' : 'false');
  crosshair.hidden = nextMode !== 'walk';
  if (nextMode === 'orbit' && ceilingVisible && camera.position.y > 2.5) {
    // Keep ceiling toggled by user, or let user press C
  }
  announce(nextMode === 'walk' ? 'Walk mode active' : 'Orbit mode active');
}

function toggleCeiling() {
  ceilingVisible = !ceilingVisible;
  arch.ceilingGroup.visible = ceilingVisible;
  btnCeiling.setAttribute('aria-pressed', ceilingVisible ? 'true' : 'false');
  announce(ceilingVisible ? 'Roof and ceiling shown' : 'Cutaway dollhouse view');
}

function cycleLighting() {
  lightingIdx = (lightingIdx + 1) % LIGHTING_MODES.length;
  const mode = LIGHTING_MODES[lightingIdx];
  lighting.applyMode(mode);
  btnLighting.textContent = LIGHTING_LABELS[mode];
  btnLighting.setAttribute('aria-pressed', mode !== 'daylight' ? 'true' : 'false');
  announce(`Lighting set to ${LIGHTING_LABELS[mode]}`);
}

function toggleMinimap() {
  minimapVisible = !minimapVisible;
  minimapPanel.hidden = !minimapVisible;
  btnMinimap.setAttribute('aria-pressed', minimapVisible ? 'true' : 'false');
}

function clearSelection() {
  selectedGroup = null;
  if (selectionBox) {
    scene.remove(selectionBox);
    selectionBox.geometry.dispose();
    selectionBox.material.dispose();
    selectionBox = null;
  }
  inspectorCard.hidden = true;
}

function selectAsset(group) {
  clearSelection();
  selectedGroup = group;
  const box = new THREE.Box3().setFromObject(group);
  selectionBox = new THREE.Box3Helper(box, 0x4fd1a5);
  scene.add(selectionBox);
  showAssetInspector(group.userData.simreadyMeta, group.userData.placementInfo);
  announce(`Selected ${group.userData.placementInfo.label}`);
}

const minimap = createMinimap(document.getElementById('minimap-canvas'), jumpToRoom);

// Toolbar actions
for (const btn of roomButtons) {
  btn.addEventListener('click', () => jumpToRoom(btn.dataset.room));
}
btnWalk.addEventListener('click', () => setMode('walk'));
btnOrbit.addEventListener('click', () => setMode('orbit'));
btnCeiling.addEventListener('click', toggleCeiling);
btnLighting.addEventListener('click', cycleLighting);
btnMinimap.addEventListener('click', toggleMinimap);
document.getElementById('insp-close').addEventListener('click', clearSelection);

// Global keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (document.querySelector('dialog[open]')) return;

  const roomMap = ['living', 'kitchen', 'study', 'bedroom', 'bathroom', 'deck'];
  if (e.key >= '1' && e.key <= '6') {
    jumpToRoom(roomMap[Number(e.key) - 1]);
  } else if (e.code === 'KeyC') {
    toggleCeiling();
  } else if (e.code === 'KeyL') {
    cycleLighting();
  } else if (e.code === 'KeyM') {
    toggleMinimap();
  } else if (e.code === 'KeyV') {
    setMode(explorer.mode === 'walk' ? 'orbit' : 'walk');
  } else if (e.key === 'Escape') {
    clearSelection();
  } else if (e.key === '?') {
    const dlg = document.getElementById('help-dialog');
    if (!dlg.open) dlg.showModal();
  }
});

// Raycasting for clicking furniture or doors
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const interactiveRoots = [];

canvas.addEventListener('pointerup', (e) => {
  if (explorer.mode === 'walk' && !explorer.wasClick() && document.pointerLockElement !== canvas) {
    return;
  }
  if (document.pointerLockElement === canvas) {
    pointerNDC.set(0, 0);
  } else {
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  raycaster.setFromCamera(pointerNDC, camera);
  const targets = [...arch.doors.map((d) => d.leaf), ...interactiveRoots];
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) {
    if (document.pointerLockElement !== canvas) clearSelection();
    return;
  }

  let obj = hits[0].object;
  while (obj) {
    if (obj.userData && obj.userData.interactiveDoorId != null) {
      const door = arch.doors[obj.userData.interactiveDoorId];
      if (door) {
        door.isOpen = !door.isOpen;
        door.targetAngle = door.isOpen ? door.openAngle : door.closedAngle;
        announce(`${door.name} ${door.isOpen ? 'opened' : 'closed'}`);
      }
      return;
    }
    if (obj.userData && obj.userData.simreadyMeta) {
      selectAsset(obj);
      return;
    }
    obj = obj.parent;
  }
});

// Resize handling
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Load all NVIDIA SimReady GLBs into the home
loadAndPlaceFurnishings(scene, arch, interactiveRoots, (loaded, total) => {
  const pct = Math.round((loaded / Math.max(1, total)) * 100);
  loadingProgress.value = pct;
  loadingPct.textContent = `${pct}%`;
  if (loaded >= total) {
    setTimeout(() => {
      loadingBanner.hidden = true;
      announce('All NVIDIA SimReady furnishings loaded');
    }, 350);
  }
}).catch((err) => {
  console.error('Failed to load furnishings:', err);
  loadingPct.textContent = 'Error';
});

// Animation loop
const clock = new THREE.Clock();
let lastDetectedRoom = '';

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  explorer.update(dt);

  // Smooth door swing animation
  for (const door of arch.doors) {
    const diff = door.targetAngle - door.pivot.rotation.y;
    if (Math.abs(diff) > 0.002) {
      door.pivot.rotation.y += diff * Math.min(1, dt * 8.5);
    }
  }

  // Update current room indicator & minimap
  const roomName = detectRoomName(camera.position.x, camera.position.z);
  if (roomName !== lastDetectedRoom) {
    lastDetectedRoom = roomName;
    roomLabelEl.textContent = roomName;
  }
  if (minimapVisible) {
    minimap.draw(camera.position.x, camera.position.z, explorer.yaw);
  }

  renderer.render(scene, camera);
}

animate();
