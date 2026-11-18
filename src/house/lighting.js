import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const LIGHTING_MODES = ['daylight', 'golden', 'evening'];

export const LIGHTING_LABELS = {
  daylight: 'Daylight',
  golden: 'Golden Hour',
  evening: 'Warm Evening',
};

export function setupLighting(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.65;

  // Sky / backdrop color + gentle distance fog
  scene.background = new THREE.Color(0xcce2f0);
  scene.fog = new THREE.Fog(0xcce2f0, 26, 68);

  const hemiLight = new THREE.HemisphereLight(0xf6f9ff, 0x8d7b66, 0.85);
  hemiLight.position.set(0, 12, 0);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff6e8, 2.2);
  sunLight.position.set(11, 16, 13);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 2;
  sunLight.shadow.camera.far = 42;
  const d = 14;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.025;
  scene.add(sunLight);

  // Subtle cool sky fill from North-West
  const fillLight = new THREE.DirectionalLight(0xd9e9ff, 0.45);
  fillLight.position.set(-10, 9, -10);
  scene.add(fillLight);

  // Interior room warm architectural lights (boost in Golden / Evening modes)
  const roomLights = [];
  const addRoomLight = (x, y, z, color, intensity, distance) => {
    const pt = new THREE.PointLight(color, intensity, distance, 1.4);
    pt.position.set(x, y, z);
    scene.add(pt);
    roomLights.push({ light: pt, baseIntensity: intensity });
    return pt;
  };

  addRoomLight(-3.8, 2.75, 2.2, 0xffebd1, 1.4, 11.0); // Living room
  addRoomLight(-3.8, 2.75, -2.7, 0xfff0d9, 1.6, 11.0); // Kitchen & Island
  addRoomLight(-0.1, 2.75, 3.6, 0xffebd1, 0.9, 7.0); // Entry Foyer
  addRoomLight(3.9, 2.75, 3.1, 0xffefda, 1.4, 9.5); // Study / Home Office
  addRoomLight(5.2, 2.75, -2.0, 0xffe4c4, 1.3, 9.5); // Primary Bedroom
  addRoomLight(2.1, 2.75, -3.3, 0xfff4e8, 1.3, 7.0); // Bathroom
  addRoomLight(2.0, 2.75, -0.3, 0xffebd1, 0.8, 6.5); // Hallway

  // Warm bedside & accent pools (subtle in daylight, cozy in evening)
  const accentLamps = [];
  const addAccentLamp = (x, y, z, color, eveningIntensity, distance) => {
    const pt = new THREE.PointLight(color, 0.15, distance, 1.6);
    pt.position.set(x, y, z);
    scene.add(pt);
    accentLamps.push({ light: pt, eveningIntensity });
  };

  addAccentLamp(4.0, 0.92, -4.55, 0xffb86c, 1.4, 4.2); // Bedroom left nightstand lamp
  addAccentLamp(6.35, 0.92, -4.55, 0xffb86c, 1.4, 4.2); // Bedroom right nightstand lamp
  addAccentLamp(4.85, 1.28, 4.35, 0xffc680, 1.2, 4.2); // Study desk lamp
  addAccentLamp(-4.2, 1.48, -4.5, 0xffe1b5, 1.1, 4.5); // Under-cabinet kitchen prep glow

  function applyMode(mode) {
    if (mode === 'daylight') {
      scene.background.setHex(0xcce2f0);
      scene.fog.color.setHex(0xcce2f0);
      scene.environmentIntensity = 0.65;
      hemiLight.color.setHex(0xf6f9ff);
      hemiLight.groundColor.setHex(0x8d7b66);
      hemiLight.intensity = 0.85;
      sunLight.color.setHex(0xfff6e8);
      sunLight.intensity = 2.2;
      sunLight.position.set(11, 16, 13);
      fillLight.intensity = 0.45;
      for (const r of roomLights) r.light.intensity = r.baseIntensity * 0.75;
      for (const a of accentLamps) a.light.intensity = 0.15;
    } else if (mode === 'golden') {
      scene.background.setHex(0xe8c49a);
      scene.fog.color.setHex(0xe8c49a);
      scene.environmentIntensity = 0.52;
      hemiLight.color.setHex(0xffd9b3);
      hemiLight.groundColor.setHex(0x6b523d);
      hemiLight.intensity = 0.72;
      sunLight.color.setHex(0xffa95e);
      sunLight.intensity = 2.5;
      sunLight.position.set(-14, 6.5, 12);
      fillLight.intensity = 0.35;
      for (const r of roomLights) r.light.intensity = r.baseIntensity * 1.45;
      for (const a of accentLamps) a.light.intensity = a.eveningIntensity * 0.7;
    } else {
      // Warm Evening
      scene.background.setHex(0x161b26);
      scene.fog.color.setHex(0x161b26);
      scene.environmentIntensity = 0.25;
      hemiLight.color.setHex(0x3a4a6b);
      hemiLight.groundColor.setHex(0x2d241c);
      hemiLight.intensity = 0.48;
      sunLight.color.setHex(0x7d98c9); // cool moonlight
      sunLight.intensity = 0.55;
      sunLight.position.set(-8, 15, 11);
      fillLight.intensity = 0.16;
      for (const r of roomLights) r.light.intensity = r.baseIntensity * 2.25;
      for (const a of accentLamps) a.light.intensity = a.eveningIntensity;
    }
  }

  applyMode('daylight');

  return {
    applyMode,
    dispose() {
      pmrem.dispose();
      envTex.dispose();
    },
  };
}
