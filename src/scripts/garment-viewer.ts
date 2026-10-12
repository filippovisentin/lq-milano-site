// Rotating 3D view of a garment, built from two ordinary photos.
// Assets from scripts/lib/garment3d.mjs: front/back RGBA textures sharing ONE
// silhouette, plus a depth map. Here they become a single closed solid:
//   front shell (z = +depth) + back shell (z = -depth) + a side wall stitched
//   along the whole outline, so there is never a gap between the two halves.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BufferGeometry, BufferAttribute, PlaneGeometry,
  MeshStandardMaterial, MeshBasicMaterial, HemisphereLight, DirectionalLight, TextureLoader, SRGBColorSpace,
  ACESFilmicToneMapping, CanvasTexture, DoubleSide, FrontSide, PMREMGenerator, MathUtils, type Texture,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface ViewerOptions { base: string; version?: number | string | null; label?: string }
export interface ViewerHandle {
  setAuto(on: boolean): void;
  isAuto(): boolean;
  face(side: 'front' | 'back' | 'side'): void;
  destroy(): void;
}

const N = 200; // grid cells per side
const THICK = 0.15; // max half-thickness, in garment-width units (a jacket is ~30% as deep as it is wide)
const MIN_WALL = 0.012; // the outline is never paper-thin

type Px = { data: Uint8ClampedArray; w: number; h: number };
function pixels(img: HTMLImageElement | ImageBitmap): Px {
  const w = img.width, h = img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}
function sample(p: Px, u: number, v: number, ch: number) {
  const x = Math.min(p.w - 1, Math.max(0, Math.round(u * (p.w - 1))));
  const y = Math.min(p.h - 1, Math.max(0, Math.round((1 - v) * (p.h - 1))));
  return p.data[(y * p.w + x) * 4 + ch] / 255;
}

function buildSolid(alpha: Px, depth: Px) {
  const V = N + 1;
  const inside = new Uint8Array(V * V);
  const z = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const u = i / N, v = j / N, k = j * V + i;
    inside[k] = sample(alpha, u, v, 3) > 0.5 ? 1 : 0;
    z[k] = Math.max(MIN_WALL, sample(depth, u, v, 0) * THICK);
  }
  const full = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * V + i;
    full[j * N + i] = inside[a] && inside[a + 1] && inside[a + V] && inside[a + V + 1] ? 1 : 0;
  }

  // shells: shared vertex grid, separate index buffers
  const pos = new Float32Array(V * V * 3), uv = new Float32Array(V * V * 2);
  const posB = new Float32Array(V * V * 3), uvB = new Float32Array(V * V * 2);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const k = j * V + i, x = i / N - 0.5, y = j / N - 0.5;
    pos.set([x, y, z[k]], k * 3); uv.set([i / N, j / N], k * 2);
    posB.set([x, y, -z[k]], k * 3); uvB.set([1 - i / N, j / N], k * 2); // back texture is authored seen from behind
  }
  const fi: number[] = [], bi: number[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (!full[j * N + i]) continue;
    const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
    fi.push(a, b, d, a, d, c);
    bi.push(a, d, b, a, c, d);
  }
  const shell = (p: Float32Array, t: Float32Array, idx: number[]) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(p, 3));
    g.setAttribute('uv', new BufferAttribute(t, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // side wall along every edge between a full cell and an empty one
  const wp: number[] = [], wu: number[] = [];
  const quad = (ka: number, kb: number) => {
    // ka -> kb runs counter-clockwise around the solid seen from the front
    const xa = (ka % V) / N - 0.5, ya = Math.floor(ka / V) / N - 0.5;
    const xb = (kb % V) / N - 0.5, yb = Math.floor(kb / V) / N - 0.5;
    const ua = [(ka % V) / N, Math.floor(ka / V) / N], ub = [(kb % V) / N, Math.floor(kb / V) / N];
    const A = [xa, ya, z[ka]], B = [xb, yb, z[kb]], C = [xb, yb, -z[kb]], D = [xa, ya, -z[ka]];
    wp.push(...A, ...C, ...B, ...A, ...D, ...C);
    wu.push(...ua, ...ub, ...ub, ...ua, ...ua, ...ub);
  };
  const isFull = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N && full[j * N + i] === 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (!full[j * N + i]) continue;
    const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
    if (!isFull(i, j - 1)) quad(a, b); // bottom edge
    if (!isFull(i + 1, j)) quad(b, d); // right
    if (!isFull(i, j + 1)) quad(d, c); // top
    if (!isFull(i - 1, j)) quad(c, a); // left
  }
  const wall = new BufferGeometry();
  wall.setAttribute('position', new BufferAttribute(new Float32Array(wp), 3));
  wall.setAttribute('uv', new BufferAttribute(new Float32Array(wu), 2));
  wall.computeVertexNormals();

  return { front: shell(pos, uv, fi), back: shell(posB, uvB, bi), wall };
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 4, 128, 128, 126);
  grd.addColorStop(0, 'rgba(30,20,12,0.45)');
  grd.addColorStop(0.55, 'rgba(30,20,12,0.14)');
  grd.addColorStop(1, 'rgba(30,20,12,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}

const loadImage = (url: string) => new Promise<HTMLImageElement>((res, rej) => {
  const i = new Image(); i.crossOrigin = 'anonymous'; i.decoding = 'async';
  i.onload = () => res(i); i.onerror = rej; i.src = url;
});

export async function mountViewer(host: HTMLElement, opts: ViewerOptions): Promise<ViewerHandle> {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const q = opts.version ? `?v=${opts.version}` : '';
  const url = (n: string) => `${opts.base}/${n}${q}`;

  const [fImg, bImg, dImg] = await Promise.all([loadImage(url('front.webp')), loadImage(url('back.webp')), loadImage(url('depth.png'))]);
  const geo = buildSolid(pixels(fImg), pixels(dImg));

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const camera = new PerspectiveCamera(28, 1, 0.1, 20);

  scene.add(new HemisphereLight(0xfff4e6, 0x3a2f26, 0.75));
  const key = new DirectionalLight(0xfff0dc, 1.7); key.position.set(1.6, 2.2, 3); scene.add(key);
  const fill = new DirectionalLight(0xe6ecff, 0.45); fill.position.set(-2.5, 0.4, 1.4); scene.add(fill);
  const backL = new DirectionalLight(0xfff0dc, 1.3); backL.position.set(-1.2, 1.8, -3); scene.add(backL);
  const rim = new DirectionalLight(0xff6a33, 0.85); rim.position.set(2.6, 0.6, -1.6); scene.add(rim); // the shop's neon

  const tex = (img: HTMLImageElement): Texture => {
    const t = new TextureLoader().load(img.src);
    t.colorSpace = SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  const fTex = tex(fImg), bTex = tex(bImg);
  const mat = (map: Texture) => new MeshStandardMaterial({ map, roughness: 0.86, metalness: 0, side: FrontSide });
  const garment = new Group();
  garment.add(new Mesh(geo.front, mat(fTex)));
  garment.add(new Mesh(geo.back, mat(bTex)));
  garment.add(new Mesh(geo.wall, new MeshStandardMaterial({ map: fTex, roughness: 0.9, side: DoubleSide, color: 0xd9d2c8 })));
  const pivot = new Group();
  pivot.add(garment);
  scene.add(pivot);

  const shadow = new Mesh(new PlaneGeometry(1.1, 0.36), new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.53;
  scene.add(shadow);

  host.prepend(canvas);

  // ---- state ----
  let yaw = reduce ? 0 : -1.1, pitch = 0, vel = 0;
  let target: number | null = reduce ? null : 0.35;
  let auto = !reduce;
  let dragging = false, lastX = 0, lastY = 0, lastT = 0, idleSince = performance.now();
  let visible = true, raf = 0, intro = reduce ? 1 : 0;
  const AUTO_SPEED = 0.42;

  function resize() {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const need = Math.max(1.12, 1.12 / camera.aspect);
    camera.position.set(0, 0.02, need / (2 * Math.tan(MathUtils.degToRad(camera.fov / 2))) + 0.1);
    camera.updateProjectionMatrix();
    kick();
  }

  let prev = performance.now();
  function frame(now: number) {
    raf = 0;
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    let moving = false;
    if (intro < 1) { intro = Math.min(1, intro + dt / 1.1); moving = true; }
    if (!dragging) {
      if (target !== null) {
        const diff = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
        yaw += diff * Math.min(1, dt * 4.5);
        if (Math.abs(diff) < 0.002) { yaw = target; target = null; idleSince = now; } else moving = true;
      } else if (Math.abs(vel) > 0.01) {
        yaw += vel * dt; vel *= Math.pow(0.04, dt); moving = true;
      } else if (auto) {
        if (now - idleSince > 1400) yaw += AUTO_SPEED * dt;
        moving = true;
      }
      pitch += (0 - pitch) * Math.min(1, dt * 3);
      if (Math.abs(pitch) > 0.001) moving = true;
    } else moving = true;
    const e = 1 - Math.pow(1 - intro, 3);
    pivot.rotation.set(pitch, yaw, 0);
    pivot.scale.setScalar(0.92 + 0.08 * e);
    pivot.position.y = 0.04 * (1 - e);
    (shadow.material as MeshBasicMaterial).opacity = e;
    renderer.render(scene, camera);
    if (moving && visible) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && visible) { prev = performance.now(); raf = requestAnimationFrame(frame); } }

  // ---- input ----
  host.style.touchAction = 'pan-y';
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY; lastT = performance.now(); vel = 0; target = null;
    host.setPointerCapture(e.pointerId); host.classList.add('is-grabbing'); kick();
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const now = performance.now(), dx = e.clientX - lastX, dy = e.clientY - lastY;
    const w = host.clientWidth || 1;
    const d = (dx / w) * Math.PI * 1.6;
    yaw += d; pitch = MathUtils.clamp(pitch + (dy / w) * 1.2, -0.35, 0.35);
    vel = d / Math.max(0.008, (now - lastT) / 1000);
    lastX = e.clientX; lastY = e.clientY; lastT = now;
  };
  const onUp = () => { if (!dragging) return; dragging = false; idleSince = performance.now(); host.classList.remove('is-grabbing'); vel = MathUtils.clamp(vel, -9, 9); kick(); };
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  const onKey = (e: KeyboardEvent) => {
    const step = MathUtils.degToRad(e.shiftKey ? 45 : 20);
    if (e.key === 'ArrowLeft') target = (target ?? yaw) - step;
    else if (e.key === 'ArrowRight') target = (target ?? yaw) + step;
    else return;
    e.preventDefault(); idleSince = performance.now(); kick();
  };
  host.addEventListener('keydown', onKey);

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) kick(); });
  io.observe(host);
  const onVis = () => { visible = document.visibilityState === 'visible'; if (visible) kick(); };
  document.addEventListener('visibilitychange', onVis);
  resize();

  const snap = (base: number) => Math.round((yaw - base) / (2 * Math.PI)) * 2 * Math.PI + base;
  return {
    setAuto(on) { auto = on; idleSince = performance.now() - 2000; kick(); },
    isAuto: () => auto,
    face(s) { target = snap(s === 'front' ? 0 : s === 'back' ? Math.PI : Math.PI / 2); vel = 0; kick(); },
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      host.removeEventListener('keydown', onKey);
      renderer.dispose(); pmrem.dispose(); canvas.remove();
    },
  };
}
