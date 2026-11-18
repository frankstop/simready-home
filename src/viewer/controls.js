import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createExplorerController(camera, canvas, colliders) {
  let mode = 'walk'; // 'walk' | 'orbit'
  const EYE_Y = 1.62;
  const WALK_SPEED = 3.2;
  const SPRINT_SPEED = 5.8;

  // Walk camera Euler angles (YXZ order)
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  camera.rotation.order = 'YXZ';

  // OrbitControls for dollhouse / aerial view
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.maxPolarAngle = Math.PI * 0.485;
  orbit.minDistance = 2.2;
  orbit.maxDistance = 30.0;
  orbit.enabled = false;

  // Input state
  const keys = new Set();
  let isDragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let dragDistance = 0;

  // Smooth teleport glide
  let glide = null;

  function syncEulerFromCamera() {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.z = 0;
  }

  function lookAtTarget(posArr, targetArr) {
    camera.position.set(posArr[0], posArr[1], posArr[2]);
    camera.lookAt(targetArr[0], targetArr[1], targetArr[2]);
    syncEulerFromCamera();
    orbit.target.set(targetArr[0], targetArr[1], targetArr[2]);
  }

  function setMode(nextMode) {
    if (nextMode === mode) return;
    mode = nextMode;
    glide = null;
    if (mode === 'orbit') {
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }
      // Compute a nice target 4m ahead of camera if staying local, or house center if high
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const target = camera.position.clone().addScaledVector(forward, 4.0);
      target.y = Math.max(0.4, Math.min(1.5, target.y));
      orbit.target.copy(target);
      if (camera.position.y < 2.2) {
        camera.position.y = 3.8;
        camera.position.addScaledVector(forward, -2.5);
      }
      orbit.enabled = true;
      orbit.update();
    } else {
      orbit.enabled = false;
      camera.position.y = EYE_Y;
      // Gently level pitch
      syncEulerFromCamera();
      euler.x = Math.max(-0.45, Math.min(0.45, euler.x));
      camera.quaternion.setFromEuler(euler);
    }
  }

  function teleportTo(viewpoint, onArrive) {
    const endPos = mode === 'walk'
      ? new THREE.Vector3(...viewpoint.walkPos)
      : new THREE.Vector3(...viewpoint.orbitPos);
    const endLook = mode === 'walk'
      ? new THREE.Vector3(...viewpoint.walkTarget)
      : new THREE.Vector3(...viewpoint.orbitTarget);

    const tempCam = camera.clone();
    tempCam.position.copy(endPos);
    tempCam.lookAt(endLook);

    glide = {
      t: 0,
      duration: 0.65,
      startPos: camera.position.clone(),
      endPos,
      startQuat: camera.quaternion.clone(),
      endQuat: tempCam.quaternion.clone(),
      startTarget: orbit.target.clone(),
      endTarget: endLook,
      onArrive,
    };
  }

  function isBlocked(x, z) {
    if (x < -14 || x > 14 || z < -12 || z > 15) return true;
    for (const c of colliders) {
      if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) {
        return true;
      }
    }
    return false;
  }

  // Event listeners
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (document.querySelector('dialog[open]')) return;
    keys.add(e.code);
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });

  window.addEventListener('blur', () => {
    keys.clear();
    isDragging = false;
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'walk') return;
    isDragging = true;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    dragDistance = 0;
  });

  window.addEventListener('pointermove', (e) => {
    if (mode !== 'walk') return;
    if (document.pointerLockElement === canvas) {
      glide = null;
      euler.y -= e.movementX * 0.0022;
      euler.x -= e.movementY * 0.0022;
      euler.x = Math.max(-Math.PI * 0.44, Math.min(Math.PI * 0.44, euler.x));
      camera.quaternion.setFromEuler(euler);
      return;
    }
    if (!isDragging) return;
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    dragDistance += Math.hypot(dx, dy);
    if (dragDistance > 3) glide = null;

    euler.y += dx * 0.0036;
    euler.x += dy * 0.0032;
    euler.x = Math.max(-Math.PI * 0.44, Math.min(Math.PI * 0.44, euler.x));
    camera.quaternion.setFromEuler(euler);
  });

  window.addEventListener('pointerup', () => {
    isDragging = false;
  });

  canvas.addEventListener('dblclick', () => {
    if (mode === 'walk' && canvas.requestPointerLock) {
      canvas.requestPointerLock();
    }
  });

  function wasClick() {
    return dragDistance < 6;
  }

  function update(dt) {
    const clampedDt = Math.min(dt, 0.05);

    if (glide) {
      glide.t += clampedDt / glide.duration;
      const u = Math.min(1, glide.t);
      const ease = 1 - Math.pow(1 - u, 3);
      camera.position.lerpVectors(glide.startPos, glide.endPos, ease);
      if (mode === 'walk') {
        camera.quaternion.slerpQuaternions(glide.startQuat, glide.endQuat, ease);
        syncEulerFromCamera();
      } else {
        orbit.target.lerpVectors(glide.startTarget, glide.endTarget, ease);
        orbit.update();
      }
      if (u >= 1) {
        const cb = glide.onArrive;
        glide = null;
        if (cb) cb();
      }
      return;
    }

    if (mode === 'orbit') {
      orbit.update();
      return;
    }

    // Walk mode WASD / Arrows movement
    let moveFwd = 0;
    let moveRight = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) moveFwd += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) moveFwd -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) moveRight += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) moveRight -= 1;

    if (moveFwd !== 0 || moveRight !== 0) {
      const len = Math.hypot(moveFwd, moveRight);
      moveFwd /= len;
      moveRight /= len;

      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? SPRINT_SPEED : WALK_SPEED;
      const forwardX = -Math.sin(euler.y);
      const forwardZ = -Math.cos(euler.y);
      const rightX = Math.cos(euler.y);
      const rightZ = -Math.sin(euler.y);

      const stepX = (forwardX * moveFwd + rightX * moveRight) * speed * clampedDt;
      const stepZ = (forwardZ * moveFwd + rightZ * moveRight) * speed * clampedDt;

      const nextX = camera.position.x + stepX;
      if (!isBlocked(nextX, camera.position.z)) {
        camera.position.x = nextX;
      }
      const nextZ = camera.position.z + stepZ;
      if (!isBlocked(camera.position.x, nextZ)) {
        camera.position.z = nextZ;
      }
    }

    camera.position.y = EYE_Y;
  }

  return {
    get mode() { return mode; },
    get yaw() { return euler.y; },
    setMode,
    lookAtTarget,
    teleportTo,
    wasClick,
    update,
  };
}
