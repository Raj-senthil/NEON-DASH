/* ============================================================
   NEON DASH — 3D endless runner
   Three.js scene, gameplay, effects and UI wiring.
   ============================================================ */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ============================ CONFIG ============================ */
const LANES        = [-2.5, 0, 2.5];
const SEG_LEN      = 20;
const TILE_LEN     = 2.5;
const TILES_PER_SEG = 8;              // 8 * 2.5 = 20
const SEG_COUNT    = 12;              // 240 units of track
const BASE_SPEED   = 14;
const MAX_SPEED    = 36;
const ACCEL        = 0.42;
const GRAVITY      = -38;
const JUMP_V       = 13;
const COYOTE       = 0.1;
const PLAYER_HALF  = 0.45;
const IDLE_SPEED   = 8;
const BEST_KEY     = 'neonDash.best';

/* ============================ STATE ============================ */
// home | playing | paused | falling | dying | gameover
let state = 'home';
let speed = BASE_SPEED, curSpeed = IDLE_SPEED;
let dist = 0, coinsCount = 0, score = 0;
let best = Number(localStorage.getItem(BEST_KEY) || 0);

let laneIdx = 1, vy = 0, grounded = true, coyote = 0;
let shakeT = 0, fallV = 0, elapsed = 0;
let camX = 0, camY = 3.4;
let dyingTimer = null;

/* ============================ DOM ============================ */
const $ = id => document.getElementById(id);
const canvas    = $('game');
const hud       = $('hud');
const hudScore  = $('hudScore');
const hudCoins  = $('hudCoins');
const hudMult   = $('hudMult');
const hudFill   = $('hudSpeedFill');
const bestHome  = $('bestHome');
const flashEl   = $('flash');
const screens   = { home: $('home'), pause: $('pause'), gameover: $('gameover') };
const newBestEl = $('newBest');

/* ============================ AUDIO ============================ */
const SFX = (() => {
  let ctx = null;
  const ac = () => {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ } }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function tone({ freq = 440, end = freq, dur = 0.15, type = 'sine', vol = 0.1, delay = 0 }) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(end, 1), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }
  return {
    unlock: ac,
    jump:  () => tone({ freq: 250, end: 640, dur: 0.18, type: 'square',   vol: 0.06 }),
    coin:  () => { tone({ freq: 980,  dur: 0.07, vol: 0.08 }); tone({ freq: 1470, dur: 0.12, vol: 0.08, delay: 0.06 }); },
    lane:  () => tone({ freq: 230, end: 175, dur: 0.06, type: 'triangle', vol: 0.05 }),
    crash: () => { tone({ freq: 220, end: 40, dur: 0.5, type: 'sawtooth', vol: 0.16 }); tone({ freq: 110, end: 30, dur: 0.6, type: 'square', vol: 0.1 }); },
    fall:  () => tone({ freq: 420, end: 55,  dur: 0.7, type: 'sine',      vol: 0.12 }),
    click: () => tone({ freq: 540,  dur: 0.05, vol: 0.05 }),
  };
})();

/* ============================ RENDERER ============================ */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04040c);
scene.fog = new THREE.FogExp2(0x04040c, 0.011);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 700);
camera.position.set(0, 3.4, 6.4);

// Environment reflections for the metallic track
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

// Post-processing: bloom for the neon glow
const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.5, 0.5, 0.4);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ============================ LIGHTS ============================ */
scene.add(new THREE.HemisphereLight(0x3350aa, 0x050510, 0.55));

const dirLight = new THREE.DirectionalLight(0x99bbff, 1.6);
dirLight.position.set(9, 20, 8);
dirLight.target.position.set(0, 0, -18);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.left = -14;
dirLight.shadow.camera.right = 14;
dirLight.shadow.camera.top = 45;
dirLight.shadow.camera.bottom = -45;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 80;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight, dirLight.target);

/* ============================ SHARED GEO / MAT ============================ */
const tileGeo  = new THREE.BoxGeometry(2.3, 0.4, TILE_LEN - 0.1);
const railGeo  = new THREE.BoxGeometry(0.16, 0.3, SEG_LEN);
const blockGeo = new THREE.BoxGeometry(1.9, 2.0, 1.1);
const lowGeo   = new THREE.BoxGeometry(2.0, 0.65, 0.7);
const coinGeo  = new THREE.CylinderGeometry(0.36, 0.36, 0.09, 22);
const archGeo  = new THREE.TorusGeometry(4.8, 0.13, 10, 42);
const warnGeo  = new THREE.BoxGeometry(7.6, 0.06, 0.2);

const matTile  = new THREE.MeshStandardMaterial({ color: 0x101527, metalness: 0.85, roughness: 0.28, envMapIntensity: 0.8 });
const matRailA = new THREE.MeshStandardMaterial({ color: 0x02181c, emissive: 0x00e5ff, emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.4 });
const matRailB = new THREE.MeshStandardMaterial({ color: 0x14081e, emissive: 0x8a2be2, emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.4 });
const matBlock = new THREE.MeshStandardMaterial({ color: 0x1a0208, emissive: 0xff1744, emissiveIntensity: 0.95, metalness: 0.3, roughness: 0.4 });
const matLow   = new THREE.MeshStandardMaterial({ color: 0x1a0a02, emissive: 0xff6d00, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.4 });
const matCoin  = new THREE.MeshStandardMaterial({ color: 0x402c00, emissive: 0xffc400, emissiveIntensity: 1.3, metalness: 1.0, roughness: 0.25, envMapIntensity: 1.4 });
const matArch  = new THREE.MeshStandardMaterial({ color: 0x0c0316, emissive: 0x8a2be2, emissiveIntensity: 0.95 });
const matWarn  = new THREE.MeshStandardMaterial({ color: 0x1a0000, emissive: 0xff1744, emissiveIntensity: 1.2 });

/* ============================ PLAYER ============================ */
const player = new THREE.Group();
const pBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.9, 0.9, 0.9),
  new THREE.MeshStandardMaterial({ color: 0x062830, emissive: 0x00e5ff, emissiveIntensity: 0.5, metalness: 0.55, roughness: 0.22, envMapIntensity: 1.1 })
);
pBody.castShadow = true;
const pCore = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.42, 0.42),
  new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbdfaff, emissiveIntensity: 0.9 })
);
const pLight = new THREE.PointLight(0x00e5ff, 12, 12, 1.7);
pLight.position.set(0, 0.6, 0.6);
player.add(pBody, pCore, pLight);
player.position.set(0, 0.5, 0);
scene.add(player);

/* ============================ PARTICLES ============================ */
class ParticlePool {
  constructor(count) {
    this.n = count;
    this.head = 0;
    this.pos  = new Float32Array(count * 3);
    this.col  = new Float32Array(count * 3);
    this.vel  = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max  = new Float32Array(count);
    this.grav = new Float32Array(count);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -999;

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.11, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy2, vz, r, g, b, life, grav = 0) {
    const i = this.head; this.head = (i + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy2; this.vel[i3 + 2] = vz;
    this.base[i3] = r; this.base[i3 + 1] = g; this.base[i3 + 2] = b;
    this.life[i] = life; this.max[i] = life; this.grav[i] = grav;
  }
  burst(x, y, z, count, spd, colors, life, grav = 0) {
    for (let k = 0; k < count; k++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      const s = spd * (0.3 + 0.7 * Math.random());
      const c = colors[(Math.random() * colors.length) | 0];
      this.spawn(x, y, z,
        Math.sin(ph) * Math.cos(th) * s,
        Math.cos(ph) * s,
        Math.sin(ph) * Math.sin(th) * s,
        c[0], c[1], c[2],
        life * (0.6 + 0.7 * Math.random()), grav);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) { this.pos[i3 + 1] = -999; this.col[i3] = this.col[i3 + 1] = this.col[i3 + 2] = 0; continue; }
      this.vel[i3 + 1] += this.grav[i] * dt;
      this.pos[i3]     += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const f = this.life[i] / this.max[i];
      const fade = f * f;
      this.col[i3]     = this.base[i3] * fade;
      this.col[i3 + 1] = this.base[i3 + 1] * fade;
      this.col[i3 + 2] = this.base[i3 + 2] * fade;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
const particles = new ParticlePool(320);

const CYAN_SPARK  = [0.0, 0.9, 1.0];
const WHITE_SPARK = [1.0, 1.0, 1.0];
const MAGENTA     = [1.0, 0.2, 0.5];
const GOLD_SPARK  = [1.0, 0.8, 0.2];

/* Speed dust streaking past the player */
const DUST_N = 80;
const dustPos = new Float32Array(DUST_N * 3);
for (let i = 0; i < DUST_N; i++) {
  const side = Math.random() < 0.5 ? -1 : 1;
  dustPos[i * 3]     = side * (2.5 + Math.random() * 14);
  dustPos[i * 3 + 1] = 0.2 + Math.random() * 6.5;
  dustPos[i * 3 + 2] = -210 + Math.random() * 218;
}
const dustGeo = new THREE.BufferGeometry();
const dustAttr = new THREE.BufferAttribute(dustPos, 3).setUsage(THREE.DynamicDrawUsage);
dustGeo.setAttribute('position', dustAttr);
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  color: 0x66d9ff, size: 0.08, transparent: true, opacity: 0.3,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
dust.frustumCulled = false;
scene.add(dust);

/* ============================ BACKDROP ============================ */
// Starfield
{
  const N = 600;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const palette = [[0.8, 0.95, 1], [0.55, 0.8, 1], [0.75, 0.55, 1], [1, 1, 1]];
  for (let i = 0; i < N; i++) {
    const r = 140 + Math.random() * 240;
    const th = Math.random() * Math.PI * 2;
    const y = Math.random() * 0.9 + 0.05;
    pos[i * 3]     = Math.cos(th) * r;
    pos[i * 3 + 1] = y * r * 0.55 - 10;
    pos[i * 3 + 2] = Math.sin(th) * r;
    const c = palette[(Math.random() * palette.length) | 0];
    const b = 0.35 + Math.random() * 0.65;
    col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 1.4, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.6, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  }));
  scene.add(stars);
}

// Distant portal ring + glow
{
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(30, 1.3, 12, 60),
    new THREE.MeshBasicMaterial({ color: 0x7b2ff7, fog: false, transparent: true, opacity: 0.35 })
  );
  ring.position.set(0, 22, -265);
  scene.add(ring);

  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = 256;
  const g = cnv.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(160,90,255,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cnv), color: 0x8a5cff,
    transparent: true, opacity: 0.3, fog: false,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.set(160, 160, 1);
  glow.position.set(0, 24, -290);
  scene.add(glow);
}

// Far neon skyline (static, merged into a single draw call)
{
  const skyMat = new THREE.MeshStandardMaterial({ color: 0x05070f, emissive: 0x1a2f6b, emissiveIntensity: 0.8, roughness: 0.9, fog: false });
  const parts = [];
  for (let i = 0; i < 46; i++) {
    const h = 5 + Math.random() * 20;
    const g = new THREE.BoxGeometry(2 + Math.random() * 4, h, 2 + Math.random() * 4);
    const side = Math.random() < 0.5 ? -1 : 1;
    g.translate(side * (17 + Math.random() * 55), h / 2 - 6, -40 - Math.random() * 280);
    parts.push(g);
  }
  const skyline = new THREE.Mesh(mergeGeometries(parts), skyMat);
  scene.add(skyline);
}

/* ============================ TRACK SEGMENTS ============================ */
let segments = [];
let obstacleRecs = [];   // { seg, mesh, type, x, halfX, halfZ, top }
let coinRecs = [];       // { seg, mesh, x, baseY, phase }
let holeRecs = [];       // { seg, z (local), halfD }

function createSegment(index) {
  const seg = new THREE.Group();
  const tiles = [];

  for (let row = 0; row < TILES_PER_SEG; row++) {
    for (let l = 0; l < 3; l++) {
      const tile = new THREE.Mesh(tileGeo, matTile);
      tile.position.set(LANES[l], -0.2, -(row + 0.5) * TILE_LEN);
      tile.receiveShadow = true;
      tile.userData.tile = { row, lane: l };
      seg.add(tile);
      tiles.push(tile);
    }
  }
  seg.userData.tiles = tiles;

  const railMat = index % 2 ? matRailB : matRailA;
  for (const x of [-3.7, 3.7]) {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(x, 0.15, -SEG_LEN / 2);
    seg.add(rail);
  }
  scene.add(seg);
  return seg;
}

const rand = (a, b) => a + Math.random() * (b - a);
const randLane = () => (Math.random() * 3) | 0;
const pick = arr => arr[(Math.random() * arr.length) | 0];

function addBlock(seg, lane, z) {
  const m = new THREE.Mesh(blockGeo, matBlock);
  m.position.set(LANES[lane], 1.0, z);
  m.castShadow = true;
  m.userData.dynamic = true;
  seg.add(m);
  obstacleRecs.push({ seg, mesh: m, type: 'block', x: LANES[lane], halfX: 0.95, halfZ: 0.6, top: 2.0 });
}

function addLow(seg, lane, z) {
  const m = new THREE.Mesh(lowGeo, matLow);
  m.position.set(LANES[lane], 0.33, z);
  m.castShadow = true;
  m.userData.dynamic = true;
  seg.add(m);
  obstacleRecs.push({ seg, mesh: m, type: 'low', x: LANES[lane], halfX: 1.0, halfZ: 0.4, top: 0.66 });
}

function addCoin(seg, x, y, z) {
  const m = new THREE.Mesh(coinGeo, matCoin);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.userData.dynamic = true;
  seg.add(m);
  coinRecs.push({ seg, mesh: m, x, baseY: y, phase: Math.random() * Math.PI * 2 });
}

function addCoinLine(seg, lane, centerZ, elevated = false) {
  for (let k = -2; k <= 2; k++) {
    addCoin(seg, LANES[lane], elevated ? 2.25 : 0.95, centerZ + k * 1.5);
  }
}

function addArch(seg) {
  const m = new THREE.Mesh(archGeo, matArch);
  m.position.set(0, 0.35, -rand(6, 15));
  m.userData.dynamic = true;
  seg.add(m);
}

function addHole(seg) {
  const k = 2 + ((Math.random() * 4) | 0);       // rows 2..5
  for (const t of seg.userData.tiles) {
    if (t.userData.tile.row === k || t.userData.tile.row === k + 1) t.visible = false;
  }
  const z = -(k + 1) * TILE_LEN;
  holeRecs.push({ seg, z, halfD: TILE_LEN });

  // red warning strips on both gap edges
  for (const e of [z - TILE_LEN + 0.1, z + TILE_LEN - 0.1]) {
    const warn = new THREE.Mesh(warnGeo, matWarn);
    warn.position.set(0, 0.04, e);
    warn.userData.dynamic = true;
    seg.add(warn);
  }
  return z;
}

/* Spawn content for a recycled / fresh segment */
function rebuildSeg(seg, opts = {}) {
  for (const child of [...seg.children]) if (child.userData.dynamic) seg.remove(child);
  for (const t of seg.userData.tiles) t.visible = true;
  obstacleRecs = obstacleRecs.filter(o => o.seg !== seg);
  coinRecs     = coinRecs.filter(c => c.seg !== seg);
  holeRecs     = holeRecs.filter(h => h.seg !== seg);

  const menuMode = state === 'home';
  const safe = opts.safe || menuMode;

  let hasHole = false;
  if (!safe) {
    const roll = Math.random();
    const holeChance = speed > 17 ? 0.2 : 0;
    if (roll < 0.55) {
      // ---- obstacle row ----
      const rowZ = -rand(4, 16);
      const r = Math.random();
      let blocked = [];
      if (r < 0.34) {
        const l = randLane();
        addBlock(seg, l, rowZ);
        blocked = [l];
      } else if (r < 0.62) {
        const first = randLane();
        let second = (first + 1 + ((Math.random() * 2) | 0)) % 3;
        addBlock(seg, first, rowZ);
        addBlock(seg, second, rowZ);
        blocked = [first, second];
      } else {
        for (let l = 0; l < 3; l++) addLow(seg, l, rowZ);
        blocked = [0, 1, 2];
      }
      if (Math.random() < 0.75) {
        if (blocked.length === 3) addCoinLine(seg, randLane(), rowZ, true);       // arc over the jump
        else addCoinLine(seg, pick([0, 1, 2].filter(l => !blocked.includes(l))), rowZ);
      }
    } else if (roll < 0.55 + holeChance) {
      const z = addHole(seg);
      hasHole = true;
      if (Math.random() < 0.55) {
        // coin arc over the gap — teaches the jump
        for (let k = -2; k <= 2; k++) addCoin(seg, LANES[1], 2.1 - Math.abs(k) * 0.45, z + k * 1.2);
      }
    } else if (Math.random() < 0.8) {
      addCoinLine(seg, randLane(), -rand(4, 15));
    }
  } else if (Math.random() < 0.4) {
    addCoinLine(seg, randLane(), -rand(4, 14));
  }

  if (!hasHole && Math.random() < 0.3) addArch(seg);
}

for (let i = 0; i < SEG_COUNT; i++) segments.push(createSegment(i));

/* ============================ GAME FLOW ============================ */
function resetGame() {
  if (dyingTimer) { clearTimeout(dyingTimer); dyingTimer = null; }
  obstacleRecs = []; coinRecs = []; holeRecs = [];
  segments.forEach((seg, i) => {
    seg.position.z = 10 - i * SEG_LEN;
    rebuildSeg(seg, { safe: i < 4 });
  });
  player.position.set(0, 0.5, 0);
  player.visible = true;
  pBody.rotation.set(0, 0, 0);
  pBody.scale.set(1, 1, 1);
  laneIdx = 1; vy = 0; grounded = true; coyote = 0;
  fallV = 0; shakeT = 0;
  speed = BASE_SPEED; dist = 0; coinsCount = 0; score = 0;
  camX = 0; camY = 3.4;
  camera.fov = 62; camera.updateProjectionMatrix();
  updateHUD();
}

function setScreen(name) {
  for (const key in screens) screens[key].classList.toggle('active', key === name);
  hud.classList.toggle('active', name === null || name === 'pause');
}

function startGame() {
  SFX.click();
  state = 'playing';
  resetGame();
  setScreen(null);
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  SFX.click();
  setScreen('pause');
}

function resumeGame() {
  if (state !== 'paused') return;
  state = 'playing';
  SFX.click();
  setScreen(null);
}

function toMenu() {
  SFX.click();
  state = 'home';
  resetGame();
  bestHome.textContent = best.toLocaleString();
  setScreen('home');
}

function die() {
  if (state !== 'playing') return;
  state = 'dying';
  speed = 0;
  player.visible = false;
  particles.burst(player.position.x, player.position.y, 0, 90, 11,
    [CYAN_SPARK, WHITE_SPARK, MAGENTA], 0.9, -9);
  particles.burst(player.position.x, player.position.y, 0, 30, 5, [GOLD_SPARK], 0.7, -6);
  shakeT = 0.7;
  SFX.crash();
  flashEl.style.transition = 'none';
  flashEl.style.opacity = '0.85';
  requestAnimationFrame(() => {
    flashEl.style.transition = 'opacity 0.6s ease';
    flashEl.style.opacity = '0';
  });
  dyingTimer = setTimeout(showGameOver, 950);
}

function startFall() {
  if (state !== 'playing') return;
  state = 'falling';
  grounded = false;
  fallV = -3;
  pBody.rotation.x = 0; pBody.rotation.z = 0;
  SFX.fall();
}

function showGameOver() {
  state = 'gameover';
  const isBest = score > best;
  if (isBest) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
  newBestEl.classList.toggle('visible', isBest);
  $('foBest').textContent = best.toLocaleString();
  $('foCoins').textContent = String(coinsCount);
  countUp($('foScore'), score);
  setScreen('gameover');
}

function countUp(el, target, dur = 850) {
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = Math.floor(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ============================ ACTIONS ============================ */
function tryJump() {
  if (state !== 'playing') return;
  if (grounded || coyote > 0) {
    grounded = false;
    vy = JUMP_V;
    coyote = 0;
    pBody.scale.set(0.78, 1.35, 0.78);
    particles.burst(player.position.x, 0.25, 0.3, 7, 2.4, [CYAN_SPARK], 0.32, -4);
    SFX.jump();
  }
}

function changeLane(dir) {
  if (state !== 'playing') return;
  const next = Math.min(2, Math.max(0, laneIdx + dir));
  if (next !== laneIdx) { laneIdx = next; SFX.lane(); }
}

function landFx() {
  pBody.scale.set(1.25, 0.72, 1.25);
  particles.burst(player.position.x, 0.2, 0.3, 9, 3, [CYAN_SPARK], 0.3, -5);
}

/* ============================ INPUT ============================ */
addEventListener('keydown', e => {
  SFX.unlock();
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  switch (state) {
    case 'home':
      if (e.code === 'Space' || e.code === 'Enter') startGame();
      break;
    case 'playing':
      if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') tryJump();
      else if (e.code === 'KeyA' || e.code === 'ArrowLeft') { if (!e.repeat) changeLane(-1); }
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') { if (!e.repeat) changeLane(1); }
      else if (e.code === 'KeyP' || e.code === 'Escape') pauseGame();
      break;
    case 'paused':
      if (e.code === 'KeyP' || e.code === 'Escape' || e.code === 'Space') resumeGame();
      else if (e.code === 'KeyR') startGame();
      break;
    case 'gameover':
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') startGame();
      else if (e.code === 'Escape') toMenu();
      break;
  }
});

canvas.addEventListener('mousedown', () => { SFX.unlock(); tryJump(); });

$('btnPlay').addEventListener('click', startGame);
$('btnPause').addEventListener('click', pauseGame);
$('btnResume').addEventListener('click', resumeGame);
$('btnRestartP').addEventListener('click', startGame);
$('btnRestart').addEventListener('click', startGame);
$('btnMenu').addEventListener('click', toMenu);
$('btnMenuP').addEventListener('click', toMenu);

document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

/* ============================ HUD ============================ */
const speedFactor = () => Math.min(1, Math.max(0, (speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)));

let lastHud = { score: -1, coins: -1, mult: '' };

function updateHUD() {
  const s = Math.floor(score), c = coinsCount, m = 'x' + (curSpeed / BASE_SPEED).toFixed(1);
  if (s !== lastHud.score) { hudScore.textContent = s.toLocaleString(); lastHud.score = s; }
  if (c !== lastHud.coins) { hudCoins.textContent = String(c); lastHud.coins = c; }
  if (m !== lastHud.mult) { hudMult.textContent = m; lastHud.mult = m; }
  hudFill.style.width = (speedFactor() * 100).toFixed(1) + '%';
}

/* ============================ WORLD UPDATE ============================ */
function moveWorld(dz) {
  for (const seg of segments) {
    seg.position.z += dz;
    if (seg.position.z > 14) {
      seg.position.z -= SEG_COUNT * SEG_LEN;
      rebuildSeg(seg);
    }
  }
}

function updateCoins(dt) {
  for (const c of coinRecs) {
    c.mesh.rotation.z += 5 * dt;
    c.mesh.position.y = c.baseY + Math.sin(elapsed * 3 + c.phase) * 0.07;
  }
}

function updatePlayerPhysics(dt) {
  const targetX = LANES[laneIdx];
  player.position.x += (targetX - player.position.x) * Math.min(1, 12 * dt);

  if (!grounded) {
    vy += GRAVITY * dt;
    player.position.y += vy * dt;
    if (player.position.y <= 0.5 && vy <= 0) {
      player.position.y = 0.5;
      grounded = true;
      vy = 0;
      landFx();
    }
  } else {
    player.position.y = 0.5;
  }
  coyote = grounded ? COYOTE : coyote - dt;

  // cube styling: tilt into the lane change + pitch with vertical speed
  pBody.rotation.z = (player.position.x - targetX) * 0.22;
  pBody.rotation.x = grounded ? 0 : THREE.MathUtils.clamp(-vy * 0.03, -0.4, 0.4);

  // squash & stretch spring back to normal
  pBody.scale.x += (1 - pBody.scale.x) * Math.min(1, 11 * dt);
  pBody.scale.y += (1 - pBody.scale.y) * Math.min(1, 11 * dt);
  pBody.scale.z += (1 - pBody.scale.z) * Math.min(1, 11 * dt);
}

function checkCollisions() {
  const px = player.position.x, py = player.position.y;

  for (const o of obstacleRecs) {
    const wz = o.mesh.position.z + o.seg.position.z;
    if (Math.abs(wz) > o.halfZ + PLAYER_HALF) continue;
    if (Math.abs(px - o.x) > o.halfX + PLAYER_HALF) continue;
    if (o.type === 'low' && py - 0.5 >= o.top) continue;   // cleared it with a jump
    die();
    return;
  }

  for (let i = coinRecs.length - 1; i >= 0; i--) {
    const c = coinRecs[i];
    const wz = c.mesh.position.z + c.seg.position.z;
    if (Math.abs(wz) < 0.95 && Math.abs(px - c.x) < 1.05 && Math.abs(py - c.mesh.position.y) < 1.25) {
      c.seg.remove(c.mesh);
      coinRecs.splice(i, 1);
      coinsCount++;
      particles.burst(c.x, c.mesh.position.y, 0, 12, 4, [GOLD_SPARK, WHITE_SPARK], 0.45, -3);
      SFX.coin();
    }
  }

  if (grounded) {
    for (const h of holeRecs) {
      const wz = h.z + h.seg.position.z;
      if (Math.abs(wz) < 1.7) { startFall(); return; }
    }
  }
}

function updateCamera(dt) {
  const idleSway = state === 'home' ? Math.sin(elapsed * 0.35) * 1.3 : 0;
  const tx = player.position.x * 0.55 + idleSway;
  let ty = 3.4 + Math.max(player.position.y - 0.5, 0) * 0.35;
  if (state === 'falling') ty += player.position.y * 0.45;

  camX += (tx - camX) * Math.min(1, 6 * dt);
  camY += (ty - camY) * Math.min(1, 6 * dt);

  let sx = 0, sy = 0;
  if (shakeT > 0) {
    shakeT -= dt;
    const s = shakeT * 0.55;
    sx = (Math.random() * 2 - 1) * s;
    sy = (Math.random() * 2 - 1) * s;
  }
  camera.position.set(camX + sx, camY + sy, 6.4);
  camera.lookAt(camX * 0.9, 1.1 + (camY - 3.4) * 0.5, -8);

  const targetFov = 62 + speedFactor() * 9;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, 4 * dt);
    camera.updateProjectionMatrix();
  }
}

function updateDust(dt) {
  for (let i = 0; i < DUST_N; i++) {
    dustPos[i * 3 + 2] += curSpeed * dt;
    if (dustPos[i * 3 + 2] > 10) {
      dustPos[i * 3 + 2] -= 220;
      const side = Math.random() < 0.5 ? -1 : 1;
      dustPos[i * 3] = side * (2.5 + Math.random() * 14);
      dustPos[i * 3 + 1] = 0.2 + Math.random() * 6.5;
    }
  }
  dustAttr.needsUpdate = true;
}

/* ============================ MAIN LOOP ============================ */
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state === 'paused' || state === 'gameover') { composer.render(); return; }
  elapsed += dt;

  if (state === 'home') {
    curSpeed = IDLE_SPEED;
    moveWorld(curSpeed * dt);
    player.position.y = 0.5 + Math.sin(elapsed * 2) * 0.08;
    pBody.rotation.y += 0.5 * dt;
    if (Math.random() < 0.4) {
      particles.spawn(rand(-0.3, 0.3), player.position.y + rand(-0.3, 0.3), 0.4,
        rand(-0.3, 0.3), rand(0, 0.3), curSpeed * 0.85, 0, 0.9, 1, 0.4);
    }
  } else if (state === 'playing') {
    speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
    curSpeed = speed;
    dist += curSpeed * dt;
    score = Math.floor(dist) + coinsCount * 20;
    moveWorld(curSpeed * dt);
    updatePlayerPhysics(dt);
    checkCollisions();
    if (Math.random() < 0.75) {
      particles.spawn(
        player.position.x + rand(-0.25, 0.25),
        player.position.y + rand(-0.25, 0.25),
        0.4,
        rand(-0.4, 0.4), rand(0, 0.3), curSpeed * 0.85,
        0, 0.9, 1, 0.35);
    }
    updateHUD();
  } else if (state === 'falling') {
    speed = Math.max(0, speed - 12 * dt);
    curSpeed = speed;
    moveWorld(curSpeed * dt);
    fallV += GRAVITY * 1.4 * dt;
    player.position.y += fallV * dt;
    pBody.rotation.x += 3.5 * dt;
    pBody.rotation.z += 2.2 * dt;
    if (player.position.y < -5) { player.visible = false; showGameOver(); }
  } else if (state === 'dying') {
    // world is frozen; keep last displayed speed
  }

  if (state !== 'dying') updateCoins(dt);
  particles.update(dt);
  updateDust(dt);
  updateCamera(dt);
  composer.render();
}

/* ============================ RESIZE ============================ */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

/* ============================ BOOT ============================ */
bestHome.textContent = best.toLocaleString();
resetGame();
setScreen('home');
tick();
