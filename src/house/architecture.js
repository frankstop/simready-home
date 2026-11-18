import * as THREE from 'three';

function createCanvasTexture(size, drawFn, repeatX = 1, repeatY = 1, isColor = true) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.anisotropy = 8;
  return tex;
}

function makeOakFloorTextures() {
  const colorTex = createCanvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#c49d72';
    ctx.fillRect(0, 0, s, s);
    const rows = 8;
    const rowH = s / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const offset = (r % 3) * (s * 0.33);
      for (let b = -1; b <= 2; b++) {
        const x = b * (s * 0.5) + offset;
        const w = s * 0.5;
        const shade = ((r * 7 + b * 13) % 15) - 7;
        ctx.fillStyle = `rgb(${194 + shade}, ${153 + Math.round(shade * 0.8)}, ${108 + Math.round(shade * 0.6)})`;
        ctx.fillRect(x, y, w, rowH);
        // Subtle grain streaks
        ctx.strokeStyle = `rgba(110, 74, 42, 0.14)`;
        ctx.lineWidth = 1;
        for (let g = 0; g < 6; g++) {
          const gy = y + ((g + 0.5) / 6) * rowH;
          ctx.beginPath();
          ctx.moveTo(x, gy);
          ctx.bezierCurveTo(x + w * 0.33, gy + (g % 2 ? 2 : -2), x + w * 0.66, gy + (g % 2 ? -2 : 2), x + w, gy);
          ctx.stroke();
        }
        // Plank seams
        ctx.strokeStyle = 'rgba(72, 48, 28, 0.42)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, rowH - 1);
      }
    }
  }, 5, 5, true);

  const roughTex = createCanvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#8a8a8a';
    ctx.fillRect(0, 0, s, s);
    const rows = 8;
    const rowH = s / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const val = 128 + ((r * 19) % 30) - 15;
      ctx.fillStyle = `rgb(${val},${val},${val})`;
      ctx.fillRect(0, y, s, rowH - 1.5);
      ctx.fillStyle = '#d4d4d4';
      ctx.fillRect(0, y + rowH - 1.5, s, 1.5);
    }
  }, 5, 5, false);

  return { colorTex, roughTex };
}

function makeTileTexture(baseHex, groutHex, cells = 4, repeatX = 4, repeatY = 4) {
  return createCanvasTexture(512, (ctx, s) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, s, s);
    const step = s / cells;
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        const delta = ((r * 5 + c * 11) % 7) - 3;
        ctx.fillStyle = `rgba(${delta > 0 ? 255 : 0}, ${delta > 0 ? 255 : 0}, ${delta > 0 ? 255 : 0}, ${Math.abs(delta) * 0.014})`;
        ctx.fillRect(c * step, r * step, step, step);
      }
    }
    ctx.strokeStyle = groutHex;
    ctx.lineWidth = 3;
    for (let i = 0; i <= cells; i++) {
      const p = i * step;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke();
    }
  }, repeatX, repeatY, true);
}

function makePlasterTexture() {
  return createCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#f2eee7';
    ctx.fillRect(0, 0, s, s);
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 2400; i++) {
      const x = Math.floor(rand() * s);
      const y = Math.floor(rand() * s);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(180,170,155,0.045)';
      ctx.fillRect(x, y, 2, 2);
    }
  }, 4, 2, true);
}

function makeLawnTexture() {
  return createCanvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#5f7c4c';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 4200; i++) {
      const x = (i * 97) % s;
      const y = (i * 193) % s;
      const g = 105 + ((i * 31) % 38);
      ctx.fillStyle = `rgba(${Math.round(g * 0.72)}, ${g}, ${Math.round(g * 0.52)}, 0.35)`;
      ctx.fillRect(x, y, 4, 4);
    }
  }, 16, 16, true);
}

/**
 * Build a wall from (x1, z1) to (x2, z2) with rectangular openings.
 * Each opening: { fromDist, toDist, yMin, yMax, kind: 'door'|'window'|'arch', glass?: boolean, frosted?: boolean, doorSwing?: number }
 */
function buildWall({
  parent,
  colliders,
  doors,
  x1,
  z1,
  x2,
  z2,
  thickness,
  height,
  openings = [],
  wallMat,
  trimMat,
  woodDoorMat,
  glassMat,
  frostedGlassMat,
  metalMat,
  baseboardMat,
}) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const totalLen = Math.hypot(dx, dz);
  const angle = Math.atan2(-dz, dx); // Three.js Y rotation aligning +X along wall direction

  const wallRoot = new THREE.Group();
  wallRoot.position.set(x1, 0, z1);
  wallRoot.rotation.y = angle;
  parent.add(wallRoot);

  const sorted = [...openings].sort((a, b) => a.fromDist - b.fromDist);

  const addBoxLocal = (lx, ly, lz, w, h, d, mat, castShadow = true, receiveShadow = true) => {
    if (w <= 0.005 || h <= 0.005 || d <= 0.005) return null;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(lx, ly, lz);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    wallRoot.add(mesh);
    return mesh;
  };

  // Helper to push world-aligned collider for solid segments [d0, d1]
  const pushSegmentCollider = (d0, d1) => {
    if (d1 - d0 < 0.05) return;
    const ux = dx / totalLen;
    const uz = dz / totalLen;
    const p0x = x1 + ux * d0;
    const p0z = z1 + uz * d0;
    const p1x = x1 + ux * d1;
    const p1z = z1 + uz * d1;
    const pad = thickness * 0.5 + 0.18;
    colliders.push({
      minX: Math.min(p0x, p1x) - pad,
      maxX: Math.max(p0x, p1x) + pad,
      minZ: Math.min(p0z, p1z) - pad,
      maxZ: Math.max(p0z, p1z) + pad,
    });
  };

  let cursor = 0;
  for (const op of sorted) {
    // Solid wall piece before opening
    if (op.fromDist > cursor + 0.005) {
      const segW = op.fromDist - cursor;
      const cx = cursor + segW * 0.5;
      addBoxLocal(cx, height * 0.5, 0, segW, height, thickness, wallMat);
      // Baseboards on both sides
      addBoxLocal(cx, 0.055, thickness * 0.5 + 0.008, segW, 0.11, 0.016, baseboardMat, false, true);
      addBoxLocal(cx, 0.055, -thickness * 0.5 - 0.008, segW, 0.11, 0.016, baseboardMat, false, true);
      pushSegmentCollider(cursor, op.fromDist);
    }

    const opW = op.toDist - op.fromDist;
    const opCx = op.fromDist + opW * 0.5;

    // Wall below opening (for windows)
    if (op.yMin > 0.005) {
      addBoxLocal(opCx, op.yMin * 0.5, 0, opW, op.yMin, thickness, wallMat);
      addBoxLocal(opCx, 0.055, thickness * 0.5 + 0.008, opW, 0.11, 0.016, baseboardMat, false, true);
      addBoxLocal(opCx, 0.055, -thickness * 0.5 - 0.008, opW, 0.11, 0.016, baseboardMat, false, true);
      pushSegmentCollider(op.fromDist, op.toDist);
    }

    // Wall header above opening
    if (height - op.yMax > 0.005) {
      const headH = height - op.yMax;
      addBoxLocal(opCx, op.yMax + headH * 0.5, 0, opW, headH, thickness, wallMat);
    }

    // Trim & Glass / Door hardware
    if (op.kind === 'window') {
      const winH = op.yMax - op.yMin;
      const winCy = op.yMin + winH * 0.5;
      const frameD = thickness + 0.03;
      const frameT = 0.045;
      // Sill + Top + Jambs
      addBoxLocal(opCx, op.yMin + frameT * 0.5, 0, opW, frameT, frameD + 0.03, trimMat);
      addBoxLocal(opCx, op.yMax - frameT * 0.5, 0, opW, frameT, frameD, trimMat);
      addBoxLocal(op.fromDist + frameT * 0.5, winCy, 0, frameT, winH, frameD, trimMat);
      addBoxLocal(op.toDist - frameT * 0.5, winCy, 0, frameT, winH, frameD, trimMat);
      if (opW > 1.8) {
        // Center mullion
        addBoxLocal(opCx, winCy, 0, 0.04, winH - frameT * 2, frameD * 0.7, trimMat);
      }
      // Glass pane
      const gMat = op.frosted ? frostedGlassMat : glassMat;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(opW - frameT * 2, winH - frameT * 2, 0.014), gMat);
      pane.position.set(opCx, winCy, 0);
      pane.castShadow = false;
      pane.receiveShadow = false;
      wallRoot.add(pane);
    } else if (op.kind === 'door') {
      const dH = op.yMax;
      const frameT = 0.045;
      const frameD = thickness + 0.025;
      // Jambs & Header casing
      addBoxLocal(op.fromDist + frameT * 0.5, dH * 0.5, 0, frameT, dH, frameD, trimMat);
      addBoxLocal(op.toDist - frameT * 0.5, dH * 0.5, 0, frameT, dH, frameD, trimMat);
      addBoxLocal(opCx, dH - frameT * 0.5, 0, opW, frameT, frameD, trimMat);

      // Hinged door leaf
      const leafW = opW - frameT * 2 - 0.01;
      const leafH = dH - frameT - 0.015;
      const pivot = new THREE.Group();
      pivot.position.set(op.fromDist + frameT + 0.005, 0, 0);
      const openAngle = op.doorSwing ?? 1.15; // default open ~65 deg so walkways are unobstructed
      pivot.rotation.y = openAngle;
      wallRoot.add(pivot);

      const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.045), woodDoorMat);
      leaf.position.set(leafW * 0.5, leafH * 0.5 + 0.01, 0);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      leaf.userData.interactiveDoorId = doors.length;
      pivot.add(leaf);

      // Brushed steel lever handles on both sides
      for (const side of [-1, 1]) {
        const handleBase = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.015, 16), metalMat);
        handleBase.rotation.x = Math.PI * 0.5;
        handleBase.position.set(leafW - 0.09, 1.0, side * 0.03);
        pivot.add(handleBase);

        const lever = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.016, 0.016), metalMat);
        lever.position.set(leafW - 0.13, 1.0, side * 0.055);
        pivot.add(lever);
      }

      doors.push({
        id: doors.length,
        name: op.label || 'Interior Door',
        pivot,
        leaf,
        isOpen: true,
        openAngle,
        closedAngle: 0,
        targetAngle: openAngle,
      });
    }

    cursor = op.toDist;
  }

  // Final solid wall segment
  if (totalLen > cursor + 0.005) {
    const segW = totalLen - cursor;
    const cx = cursor + segW * 0.5;
    addBoxLocal(cx, height * 0.5, 0, segW, height, thickness, wallMat);
    addBoxLocal(cx, 0.055, thickness * 0.5 + 0.008, segW, 0.11, 0.016, baseboardMat, false, true);
    addBoxLocal(cx, 0.055, -thickness * 0.5 - 0.008, segW, 0.11, 0.016, baseboardMat, false, true);
    pushSegmentCollider(cursor, totalLen);
  }
}

export function buildHomeArchitecture(scene) {
  const houseGroup = new THREE.Group();
  houseGroup.name = 'HouseArchitecture';
  scene.add(houseGroup);

  const ceilingGroup = new THREE.Group();
  ceilingGroup.name = 'CeilingAndRoof';
  scene.add(ceilingGroup);

  const colliders = [];
  const doors = [];

  // Materials
  const { colorTex: oakColor, roughTex: oakRough } = makeOakFloorTextures();
  const oakFloorMat = new THREE.MeshStandardMaterial({
    map: oakColor,
    roughnessMap: oakRough,
    roughness: 0.62,
    metalness: 0.02,
  });

  const kitchenTileTex = makeTileTexture('#ddd8ce', '#b8b0a3', 4, 6, 4);
  const kitchenTileMat = new THREE.MeshStandardMaterial({
    map: kitchenTileTex,
    roughness: 0.45,
    metalness: 0.03,
  });

  const bathTileTex = makeTileTexture('#cfd4d6', '#9ea5a8', 5, 3, 4);
  const bathTileMat = new THREE.MeshStandardMaterial({
    map: bathTileTex,
    roughness: 0.38,
    metalness: 0.04,
  });

  const plasterTex = makePlasterTexture();
  const wallMat = new THREE.MeshStandardMaterial({
    map: plasterTex,
    color: 0xf6f2ea,
    roughness: 0.88,
    metalness: 0.0,
  });

  const accentWallMat = new THREE.MeshStandardMaterial({
    map: plasterTex,
    color: 0xd9dfd7, // soft sage-mineral accent wall in bedroom/living
    roughness: 0.9,
    metalness: 0.0,
  });

  const exteriorStuccoMat = new THREE.MeshStandardMaterial({
    color: 0xe9e4db,
    roughness: 0.92,
    metalness: 0.0,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x2f3134, // crisp dark architectural aluminum window frames
    roughness: 0.36,
    metalness: 0.55,
  });

  const baseboardMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.65,
    metalness: 0.02,
  });

  const woodDoorMat = new THREE.MeshStandardMaterial({
    color: 0x8b623f,
    roughness: 0.55,
    metalness: 0.03,
  });

  const walnutMat = new THREE.MeshStandardMaterial({
    color: 0x62432c,
    roughness: 0.58,
    metalness: 0.04,
  });

  const linenFabricMat = new THREE.MeshStandardMaterial({
    color: 0xdad3c7,
    roughness: 0.92,
    metalness: 0.0,
  });

  const brushedSteelMat = new THREE.MeshStandardMaterial({
    color: 0xc8cdd2,
    roughness: 0.25,
    metalness: 0.88,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdcf0f7,
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
    metalness: 0.0,
    reflectivity: 0.9,
    depthWrite: false,
  });

  const frostedGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xe6eff2,
    transparent: true,
    opacity: 0.62,
    roughness: 0.45,
    metalness: 0.0,
    depthWrite: false,
  });

  const deckMat = new THREE.MeshStandardMaterial({
    map: createCanvasTexture(512, (ctx, s) => {
      ctx.fillStyle = '#9a714b';
      ctx.fillRect(0, 0, s, s);
      const planks = 10;
      const ph = s / planks;
      for (let i = 0; i < planks; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#9e744e' : '#906843';
        ctx.fillRect(0, i * ph, s, ph - 3);
        ctx.fillStyle = '#3f2c1b';
        ctx.fillRect(0, i * ph + ph - 3, s, 3);
      }
    }, 6, 2, true),
    roughness: 0.78,
    metalness: 0.02,
  });

  // 1. Landscaped Outdoor Ground & Walkway
  const lawnMat = new THREE.MeshStandardMaterial({
    map: makeLawnTexture(),
    roughness: 0.95,
    metalness: 0.0,
  });
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(72, 72), lawnMat);
  lawn.rotation.x = -Math.PI * 0.5;
  lawn.position.y = -0.14;
  lawn.receiveShadow = true;
  houseGroup.add(lawn);

  // Foundation plinth
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(14.52, 0.16, 10.52), exteriorStuccoMat);
  plinth.position.set(0, -0.085, 0);
  plinth.receiveShadow = true;
  houseGroup.add(plinth);

  // Front stone stepping walkway leading to entry porch
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xbab4a8, roughness: 0.85 });
  for (let i = 0; i < 6; i++) {
    const paver = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.75), stoneMat);
    paver.position.set(-0.05, -0.11, 8.3 + i * 1.05);
    paver.receiveShadow = true;
    houseGroup.add(paver);
  }

  // Outdoor Cedar Sun Deck (Z: 5.18 to 7.8, X: -7.4 to 7.4)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(14.8, 0.14, 2.7), deckMat);
  deck.position.set(0, -0.075, 6.48);
  deck.receiveShadow = true;
  deck.castShadow = true;
  houseGroup.add(deck);

  // Low perimeter deck railing/step fascia
  const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.09, 0.45), deckMat);
  stepMesh.position.set(-0.05, -0.10, 7.95);
  stepMesh.receiveShadow = true;
  houseGroup.add(stepMesh);

  // 2. Interior Floor Surfaces (Y = 0)
  const addFloorPlane = (minX, maxX, minZ, maxZ, mat, y = 0.001) => {
    const w = maxX - minX;
    const d = maxZ - minZ;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.position.set((minX + maxX) * 0.5, y, (minZ + maxZ) * 0.5);
    mesh.receiveShadow = true;
    houseGroup.add(mesh);
  };

  // Main oak floor across living, foyer, dining, hall, study, bedroom
  addFloorPlane(-7.1, 7.1, -5.1, 5.1, oakFloorMat, 0.0);
  // Kitchen limestone tile zone
  addFloorPlane(-7.05, -1.35, -5.05, -0.95, kitchenTileMat, 0.002);
  // Bathroom porcelain tile zone
  addFloorPlane(0.9, 3.25, -5.05, -1.82, bathTileMat, 0.003);

  // 3. Exterior & Interior Walls (Height = 3.0m)
  const H = 3.0;
  const EXT_T = 0.18;
  const INT_T = 0.14;

  const commonOpts = {
    parent: houseGroup,
    colliders,
    doors,
    height: H,
    wallMat,
    trimMat,
    woodDoorMat,
    glassMat,
    frostedGlassMat,
    metalMat: brushedSteelMat,
    baseboardMat,
  };

  // South Front Exterior Wall: (-7.1, 5.09) -> (+7.1, 5.09), totalLen = 14.2
  // x=-7.1 is dist 0; x=0 is dist 7.1
  buildWall({
    ...commonOpts,
    x1: -7.1, z1: 5.09, x2: 7.1, z2: 5.09, thickness: EXT_T,
    openings: [
      { kind: 'window', fromDist: 0.9, toDist: 4.9, yMin: 0.28, yMax: 2.62 }, // 4m Living room window (x: -6.2 to -2.2)
      { kind: 'door', fromDist: 6.5, toDist: 7.65, yMin: 0, yMax: 2.25, doorSwing: -1.1, label: 'Front Entry Door' }, // Front door (x: -0.6 to 0.55)
      { kind: 'window', fromDist: 9.5, toDist: 11.5, yMin: 0.48, yMax: 2.58 }, // 2m Study window (x: 2.4 to 4.4)
    ],
  });

  // North Rear Exterior Wall: (-7.1, -5.09) -> (+7.1, -5.09), totalLen = 14.2
  buildWall({
    ...commonOpts,
    x1: -7.1, z1: -5.09, x2: 7.1, z2: -5.09, thickness: EXT_T,
    openings: [
      { kind: 'window', fromDist: 2.0, toDist: 4.0, yMin: 1.18, yMax: 2.48 }, // 2m Kitchen sink window (x: -5.1 to -3.1)
      { kind: 'window', fromDist: 8.6, toDist: 9.7, yMin: 1.48, yMax: 2.48, frosted: true }, // Bathroom frosted window (x: 1.5 to 2.6)
      { kind: 'window', fromDist: 11.3, toDist: 13.3, yMin: 0.62, yMax: 2.58 }, // 2m Bedroom North window (x: 4.2 to 6.2)
    ],
  });

  // West Exterior Wall: (-7.09, -5.1) -> (-7.09, 5.1), totalLen = 10.2
  // z=-5.1 is dist 0; z=0 is dist 5.1
  buildWall({
    ...commonOpts,
    x1: -7.09, z1: -5.1, x2: -7.09, z2: 5.1, thickness: EXT_T,
    openings: [
      { kind: 'window', fromDist: 6.2, toDist: 8.2, yMin: 0.52, yMax: 2.58 }, // 2m Living West window (z: 1.1 to 3.1)
    ],
  });

  // East Exterior Wall: (7.09, -5.1) -> (7.09, 5.1), totalLen = 10.2
  buildWall({
    ...commonOpts,
    x1: 7.09, z1: -5.1, x2: 7.09, z2: 5.1, thickness: EXT_T,
    openings: [
      { kind: 'window', fromDist: 1.5, toDist: 3.5, yMin: 0.62, yMax: 2.58 }, // 2m Bedroom East window (z: -3.6 to -1.6)
      { kind: 'window', fromDist: 7.3, toDist: 9.3, yMin: 0.62, yMax: 2.58 }, // 2m Study East window (z: 2.2 to 4.2)
    ],
  });

  // Interior East-Wing Dividing Spine: (0.87, -5.0) -> (0.87, 5.0), totalLen = 10.0
  // z=-5.0 is dist 0
  buildWall({
    ...commonOpts,
    x1: 0.87, z1: -5.0, x2: 0.87, z2: 5.0, thickness: INT_T,
    openings: [
      { kind: 'arch', fromDist: 3.9, toDist: 5.7, yMin: 0, yMax: 2.45 }, // 1.8m wide Hallway Archway (z: -1.1 to 0.7)
    ],
  });

  // Interior Bathroom South Wall: (0.94, -1.87) -> (3.27, -1.87), totalLen = 2.33
  buildWall({
    ...commonOpts,
    x1: 0.94, z1: -1.87, x2: 3.27, z2: -1.87, thickness: INT_T,
    openings: [
      { kind: 'door', fromDist: 0.62, toDist: 1.55, yMin: 0, yMax: 2.15, doorSwing: 1.25, label: 'Bathroom Door' },
    ],
  });

  // Interior Study North Wall: (0.94, 1.2) -> (7.0, 1.2), totalLen = 6.06
  buildWall({
    ...commonOpts,
    x1: 0.94, z1: 1.2, x2: 7.0, z2: 1.2, thickness: INT_T,
    openings: [
      { kind: 'door', fromDist: 0.55, toDist: 1.55, yMin: 0, yMax: 2.15, doorSwing: 1.25, label: 'Home Office Door' },
    ],
  });

  // Interior Bedroom West Wall: (3.27, -5.0) -> (3.27, 1.2), totalLen = 6.2
  // z=-5.0 is dist 0; doorway at z ∈ [-1.25, -0.25] => dist [3.75, 4.75]
  buildWall({
    ...commonOpts,
    x1: 3.27, z1: -5.0, x2: 3.27, z2: 1.2, thickness: INT_T,
    openings: [
      { kind: 'door', fromDist: 3.75, toDist: 4.75, yMin: 0, yMax: 2.15, doorSwing: -1.25, label: 'Primary Bedroom Door' },
    ],
  });

  // Bedroom Sage Accent Wall Paneling behind Bed (North Wall of Bedroom, X: 3.4 to 6.95, Z: -4.98)
  const headboardWallPanel = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.95, 0.025), accentWallMat);
  headboardWallPanel.position.set(5.18, 1.48, -4.97);
  headboardWallPanel.receiveShadow = true;
  houseGroup.add(headboardWallPanel);

  // Kitchen Backsplash Tile Band (kept below window sill Y=1.18 under window, taller behind cooktop)
  const backsplashMat = new THREE.MeshStandardMaterial({
    map: makeTileTexture('#ebe7df', '#c7c1b5', 8, 8, 1),
    roughness: 0.25,
    metalness: 0.05,
  });
  const backsplashLow = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.31, 0.018), backsplashMat);
  backsplashLow.position.set(-4.95, 1.015, -4.985);
  backsplashLow.receiveShadow = true;
  houseGroup.add(backsplashLow);

  const backsplashRange = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.76, 0.018), backsplashMat);
  backsplashRange.position.set(-1.90, 1.24, -4.985);
  backsplashRange.receiveShadow = true;
  houseGroup.add(backsplashRange);

  // 4. Bathroom Walk-In Shower Enclosure (X: 0.96 to 2.02, Z: -4.98 to -3.68)
  const showerCurb = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.08, 0.07), stoneMat);
  showerCurb.position.set(1.48, 0.04, -3.72);
  showerCurb.receiveShadow = true;
  houseGroup.add(showerCurb);

  const showerGlass = new THREE.Mesh(new THREE.BoxGeometry(0.018, 2.1, 1.25), glassMat);
  showerGlass.position.set(2.01, 1.08, -4.34);
  houseGroup.add(showerGlass);

  // Chrome shower column & rainfall head
  const showerPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.15, 12), brushedSteelMat);
  showerPipe.position.set(1.02, 1.65, -4.38);
  houseGroup.add(showerPipe);
  const showerArm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 12), brushedSteelMat);
  showerArm.rotation.z = Math.PI * 0.5;
  showerArm.position.set(1.18, 2.22, -4.38);
  houseGroup.add(showerArm);
  const showerHead = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 24), brushedSteelMat);
  showerHead.position.set(1.33, 2.20, -4.38);
  houseGroup.add(showerHead);

  // 5. Custom Architectural Walnut Platform Bed Frame (centered at X = 5.18, Z = -3.88)
  // Sized around SimReady bedding_a01 (~1.55m x 2.05m) — matches its measured dimensions cleanly
  const bedFrameGroup = new THREE.Group();
  bedFrameGroup.name = 'PlatformBedFrame';
  bedFrameGroup.position.set(5.18, 0, -3.88);
  houseGroup.add(bedFrameGroup);

  const bedPlatform = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.24, 2.18), walnutMat);
  bedPlatform.position.set(0, 0.16, 0);
  bedPlatform.castShadow = true;
  bedPlatform.receiveShadow = true;
  bedFrameGroup.add(bedPlatform);

  for (const [lx, lz] of [[-0.82, -0.96], [0.82, -0.96], [-0.82, 0.96], [0.82, 0.96]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.08, 12), walnutMat);
    leg.position.set(lx, 0.04, lz);
    leg.castShadow = true;
    bedFrameGroup.add(leg);
  }

  const headboardWood = new THREE.Mesh(new THREE.BoxGeometry(2.04, 1.12, 0.07), walnutMat);
  headboardWood.position.set(0, 0.58, -1.07);
  headboardWood.castShadow = true;
  headboardWood.receiveShadow = true;
  bedFrameGroup.add(headboardWood);

  const headboardCushion = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.72, 0.06), linenFabricMat);
  headboardCushion.position.set(0, 0.74, -1.01);
  headboardCushion.castShadow = true;
  bedFrameGroup.add(headboardCushion);

  colliders.push({ minX: 4.15, maxX: 6.22, minZ: -5.0, maxZ: -2.72 });

  // 6. Ceiling, Timber Beams, and Overhanging Architectural Roof (togglable for Cutaway Dollhouse view)
  const ceilingSlab = new THREE.Mesh(
    new THREE.BoxGeometry(14.36, 0.12, 10.36),
    new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 }),
  );
  ceilingSlab.position.set(0, H + 0.06, 0);
  ceilingSlab.receiveShadow = true;
  ceilingSlab.castShadow = true;
  ceilingGroup.add(ceilingSlab);

  // Warm exposed oak beams in the Great Room
  for (const bx of [-5.8, -3.7, -1.6]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 9.9), walnutMat);
    beam.position.set(bx, H - 0.09, 0);
    beam.castShadow = true;
    ceilingGroup.add(beam);
  }

  // Exterior flat cantilevered modern fascia roof overhang
  const fasciaMat = new THREE.MeshStandardMaterial({ color: 0x2d3033, roughness: 0.55, metalness: 0.25 });
  const roofOverhang = new THREE.Mesh(new THREE.BoxGeometry(15.4, 0.22, 11.8), fasciaMat);
  roofOverhang.position.set(0, H + 0.22, 0.35);
  roofOverhang.castShadow = true;
  ceilingGroup.add(roofOverhang);

  const roofTopCap = new THREE.Mesh(
    new THREE.BoxGeometry(15.0, 0.08, 11.4),
    new THREE.MeshStandardMaterial({ color: 0x5c5f63, roughness: 0.85 }),
  );
  roofTopCap.position.set(0, H + 0.36, 0.35);
  ceilingGroup.add(roofTopCap);

  return {
    houseGroup,
    ceilingGroup,
    colliders,
    doors,
    bedTopY: 0.28,
    bedCenter: { x: 5.18, z: -3.88 },
  };
}
