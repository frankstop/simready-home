export const ROOM_VIEWPOINTS = {
  living: {
    id: 'living',
    name: 'Living Room',
    walkPos: [-1.1, 1.62, 3.6],
    walkTarget: [-5.2, 1.1, 1.8],
    orbitPos: [-0.8, 4.6, 8.6],
    orbitTarget: [-3.9, 0.7, 2.0],
  },
  kitchen: {
    id: 'kitchen',
    name: 'Kitchen & Dining',
    walkPos: [-0.6, 1.62, -1.0],
    walkTarget: [-4.6, 1.0, -3.4],
    orbitPos: [-0.2, 4.8, 2.6],
    orbitTarget: [-4.0, 0.8, -3.2],
  },
  study: {
    id: 'study',
    name: 'Home Office',
    walkPos: [2.25, 1.62, 2.25],
    walkTarget: [4.15, 0.95, 3.65],
    orbitPos: [1.5, 4.2, 7.6],
    orbitTarget: [3.9, 0.8, 3.1],
  },
  bedroom: {
    id: 'bedroom',
    name: 'Primary Bedroom',
    walkPos: [3.95, 1.62, -0.45],
    walkTarget: [5.30, 0.85, -3.55],
    orbitPos: [3.8, 4.5, 3.8],
    orbitTarget: [5.1, 0.7, -2.5],
  },
  bathroom: {
    id: 'bathroom',
    name: 'Bathroom',
    walkPos: [2.08, 1.62, -2.55],
    walkTarget: [2.22, 0.92, -4.15],
    orbitPos: [2.1, 4.2, 0.6],
    orbitTarget: [2.1, 0.7, -3.5],
  },
  deck: {
    id: 'deck',
    name: 'Sun Deck & Entry',
    walkPos: [-0.1, 1.62, 7.6],
    walkTarget: [-0.5, 1.3, 2.0],
    orbitPos: [0.0, 7.5, 14.5],
    orbitTarget: [0.0, 0.9, 0.5],
  },
};

const ROOM_REGIONS = [
  { id: 'bathroom', name: 'Bathroom', minX: 0.9, maxX: 3.25, minZ: -5.05, maxZ: -1.85 },
  { id: 'bedroom', name: 'Primary Bedroom', minX: 3.25, maxX: 7.05, minZ: -5.05, maxZ: 1.2 },
  { id: 'study', name: 'Home Office', minX: 0.9, maxX: 7.05, minZ: 1.2, maxZ: 5.05 },
  { id: 'kitchen', name: 'Kitchen & Dining', minX: -7.05, maxX: 0.9, minZ: -5.05, maxZ: -0.4 },
  { id: 'living', name: 'Living Room', minX: -7.05, maxX: 0.9, minZ: -0.4, maxZ: 5.05 },
  { id: 'deck', name: 'Sun Deck & Yard', minX: -9, maxX: 9, minZ: 5.05, maxZ: 12 },
];

export function detectRoomName(x, z) {
  if (x >= 0.9 && x <= 3.25 && z >= -1.85 && z <= 1.2) return 'Hallway Gallery';
  for (const r of ROOM_REGIONS) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
      return r.name;
    }
  }
  return 'Exterior Grounds';
}

export function createMinimap(canvas, onRoomClick) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  // Map X in [-8, 8] (16m), Z in [-6, 8] (14m)
  const minX = -8.0;
  const maxX = 8.0;
  const minZ = -6.0;
  const maxZ = 8.0;

  const toPx = (wx, wz) => [
    ((wx - minX) / (maxX - minX)) * W,
    ((wz - minZ) / (maxZ - minZ)) * H,
  ];
  const toWorld = (px, py) => [
    minX + (px / W) * (maxX - minX),
    minZ + (py / H) * (maxZ - minZ),
  ];

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    const [wx, wz] = toWorld(px, py);
    for (const r of ROOM_REGIONS) {
      if (wx >= r.minX && wx <= r.maxX && wz >= r.minZ && wz <= r.maxZ) {
        onRoomClick(r.id);
        return;
      }
    }
    if (wx >= 0.9 && wx <= 3.25 && wz >= -1.85 && wz <= 1.2) {
      onRoomClick('bedroom');
    }
  });

  function draw(camX, camZ, yawRad) {
    ctx.clearRect(0, 0, W, H);

    // Background lawn
    ctx.fillStyle = 'rgba(30, 38, 34, 0.85)';
    ctx.fillRect(0, 0, W, H);

    const fillRoom = (x0, z0, x1, z1, fill, label) => {
      const [px0, py0] = toPx(x0, z0);
      const [px1, py1] = toPx(x1, z1);
      ctx.fillStyle = fill;
      ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
      ctx.fillStyle = 'rgba(240, 238, 234, 0.72)';
      ctx.font = '600 9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, (px0 + px1) * 0.5, (py0 + py1) * 0.5);
    };

    fillRoom(-7.1, 5.1, 7.1, 7.6, 'rgba(130, 96, 65, 0.52)', 'DECK');
    fillRoom(-7.0, -0.4, 0.85, 5.0, 'rgba(72, 92, 108, 0.55)', 'LIVING');
    fillRoom(-7.0, -5.0, 0.85, -0.4, 'rgba(92, 105, 88, 0.55)', 'KITCHEN');
    fillRoom(0.9, -1.85, 3.25, 1.2, 'rgba(84, 86, 94, 0.55)', 'HALL');
    fillRoom(0.9, -5.0, 3.25, -1.85, 'rgba(75, 108, 118, 0.62)', 'BATH');
    fillRoom(3.25, -5.0, 7.0, 1.2, 'rgba(104, 88, 110, 0.58)', 'BEDROOM');
    fillRoom(0.9, 1.2, 7.0, 5.0, 'rgba(112, 98, 76, 0.58)', 'STUDY');

    // Architectural walls
    ctx.strokeStyle = 'rgba(245, 242, 236, 0.85)';
    ctx.lineWidth = 2;
    const line = (x0, z0, x1, z1) => {
      const [px0, py0] = toPx(x0, z0);
      const [px1, py1] = toPx(x1, z1);
      ctx.beginPath();
      ctx.moveTo(px0, py0);
      ctx.lineTo(px1, py1);
      ctx.stroke();
    };
    // Outer perimeter
    line(-7.1, -5.1, 7.1, -5.1);
    line(7.1, -5.1, 7.1, 5.1);
    line(-7.1, 5.1, -0.6, 5.1);
    line(0.55, 5.1, 7.1, 5.1);
    line(-7.1, -5.1, -7.1, 5.1);
    // Interior partitions with doorway gaps
    line(0.87, -5.0, 0.87, -1.1);
    line(0.87, 0.7, 0.87, 5.0);
    line(0.94, -1.87, 1.56, -1.87);
    line(2.49, -1.87, 3.27, -1.87);
    line(0.94, 1.2, 1.49, 1.2);
    line(2.49, 1.2, 7.0, 1.2);
    line(3.27, -5.0, 3.27, -1.25);
    line(3.27, -0.25, 3.27, 1.2);

    // Explorer marker + FOV cone
    const [cx, cy] = toPx(camX, camZ);
    // Camera forward in XZ: (-sin(yaw), -cos(yaw))
    const fx = -Math.sin(yawRad);
    const fz = -Math.cos(yawRad);
    const coneAngle = Math.atan2(fz, fx);

    ctx.fillStyle = 'rgba(79, 209, 165, 0.28)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 18, coneAngle - 0.45, coneAngle + 0.45);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#4fd1a5';
    ctx.beginPath();
    ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#072219';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  return { draw };
}
