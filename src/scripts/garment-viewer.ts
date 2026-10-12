// Rotating 3D view of a garment, built from two ordinary photos.
// Assets come from scripts/build-3d.mjs: RGBA cut-outs (front/back) and
// silhouette depth maps. Each side is a finely subdivided plane displaced by
// its depth map, so light rolls over the shoulders and the piece reads as a
// soft volume while it turns. Drag to rotate, arrows on keyboard, or let it spin.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, PlaneGeometry, MeshStandardMaterial,
  HemisphereLight, DirectionalLight, TextureLoader, SRGBColorSpace, ACESFilmicToneMapping,
  CanvasTexture, MeshBasicMaterial, FrontSide, Color, MathUtils, type Texture,
} from 'three';

export interface ViewerOptions { base: string; hasBack: boolean; label: string }
export interface ViewerHandle {
  setAuto(on: boolean): void;
  isAuto(): boolean;
  face(side: 'front' | 'back'): void;
  destroy(): void;
}

const SEG = 150;
const DEPTH = 0.105; // per side, in plane-width units

function loadDepth(url: string): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      resolve({ data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height });
    };
    img.onerror = reject;
    img.src = url;
  });
}

function sample(d: { data: Uint8ClampedArray; w: number; h: number }, u: number, v: number) {
  // bilinear, v=0 at the bottom (plane uv) -> image row from the top
  const x = MathUtils.clamp(u, 0, 1) * (d.w - 1);
  const y = (1 - MathUtils.clamp(v, 0, 1)) * (d.h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, d.w - 1), y1 = Math.min(y0 + 1, d.h - 1);
  const fx = x - x0, fy = y - y0;
  const p = (xx: number, yy: number) => d.data[(yy * d.w + xx) * 4] / 255;
  return (p(x0, y0) * (1 - fx) + p(x1, y0) * fx) * (1 - fy) + (p(x0, y1) * (1 - fx) + p(x1, y1) * fx) * fy;
}

function side(tex: Texture, depth: Awaited<ReturnType<typeof loadDepth>>, tint?: number) {
  const geo = new PlaneGeometry(1, 1, SEG, SEG);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, sample(depth, uv.getX(i), uv.getY(i)) * DEPTH);
  geo.computeVertexNormals();
  const mat = new MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.82, metalness: 0, side: FrontSide });
  if (tint) mat.color = new Color(tint);
  return new Mesh(geo, mat);
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 4, 128, 128, 126);
  grd.addColorStop(0, 'rgba(30,20,12,0.42)');
  grd.addColorStop(0.55, 'rgba(30,20,12,0.14)');
  grd.addColorStop(1, 'rgba(30,20,12,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}

export async function mountViewer(host: HTMLElement, opts: ViewerOptions): Promise<ViewerHandle> {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new Scene();
  const camera = new PerspectiveCamera(28, 1, 0.1, 20);
  camera.position.set(0, 0.02, 2.55);

  scene.add(new HemisphereLight(0xfff4e6, 0x40342a, 1.25));
  const key = new DirectionalLight(0xfff0dc, 1.9); key.position.set(1.6, 2.2, 3); scene.add(key);
  const fill = new DirectionalLight(0xdfe6ff, 0.55); fill.position.set(-2.5, 0.5, 1.5); scene.add(fill);
  const back = new DirectionalLight(0xfff0dc, 1.4); back.position.set(-1.2, 1.8, -3); scene.add(back);
  const rim = new DirectionalLight(0xff6a33, 0.9); rim.position.set(2.6, 0.6, -1.6); scene.add(rim); // the shop neon

  const loader = new TextureLoader();
  const tex = (n: string) => loader.loadAsync(`${opts.base}/${n}`).then((t) => { t.colorSpace = SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; });
  const [fTex, fDepth, bTex, bDepth] = await Promise.all([
    tex('front.webp'), loadDepth(`${opts.base}/front-depth.png`),
    opts.hasBack ? tex('back.webp') : Promise.resolve(null),
    opts.hasBack ? loadDepth(`${opts.base}/back-depth.png`) : Promise.resolve(null),
  ]);

  const garment = new Group();
  garment.add(side(fTex, fDepth));
  const rear = bTex && bDepth ? side(bTex, bDepth) : side(fTex, fDepth, 0xbdb4a8);
  rear.rotation.y = Math.PI;
  garment.add(rear);
  const pivot = new Group();
  pivot.add(garment);
  scene.add(pivot);

  const shadow = new Mesh(new PlaneGeometry(1.1, 0.36), new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.53;
  scene.add(shadow);

  host.prepend(canvas);

  // ---- state ----
  let yaw = reduce ? 0 : -0.9, pitch = 0, vel = 0;
  let target: number | null = reduce ? null : 0; // intro: swing in to the front
  let auto = !reduce;
  let dragging = false, lastX = 0, lastY = 0, lastT = 0, idleSince = performance.now();
  let visible = true, raf = 0, intro = reduce ? 1 : 0;
  const AUTO_SPEED = 0.45; // rad/s

  function resize() {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the whole garment framed on tall/narrow and wide stages
    const fitH = 1.16, fitW = 1.16 / camera.aspect;
    const need = Math.max(fitH, fitW);
    camera.position.z = need / (2 * Math.tan(MathUtils.degToRad(camera.fov / 2)));
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
        yaw += diff * Math.min(1, dt * 5);
        if (Math.abs(diff) < 0.002) { yaw = target; target = null; idleSince = now; } else moving = true;
      } else if (Math.abs(vel) > 0.01) {
        yaw += vel * dt; vel *= Math.pow(0.04, dt); moving = true;
      } else if (auto && now - idleSince > 1400) {
        yaw += AUTO_SPEED * dt; moving = true;
      } else if (auto) moving = true;
      pitch += (0 - pitch) * Math.min(1, dt * 3);
      if (Math.abs(pitch) > 0.001) moving = true;
    } else moving = true;
    const e = 1 - Math.pow(1 - intro, 3);
    pivot.rotation.set(pitch, yaw, 0);
    pivot.scale.setScalar(0.92 + 0.08 * e);
    pivot.position.y = 0.04 * (1 - e) + Math.sin(now / 1600) * 0.006 * (auto ? 1 : 0);
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
    if (e.key === 'ArrowLeft') { target = (target ?? yaw) - step; }
    else if (e.key === 'ArrowRight') { target = (target ?? yaw) + step; }
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

  return {
    setAuto(on) { auto = on; idleSince = performance.now() - 2000; kick(); },
    isAuto: () => auto,
    face(s) { target = s === 'front' ? Math.round(yaw / (2 * Math.PI)) * 2 * Math.PI : Math.round((yaw - Math.PI) / (2 * Math.PI)) * 2 * Math.PI + Math.PI; vel = 0; kick(); },
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      host.removeEventListener('keydown', onKey);
      renderer.dispose(); canvas.remove();
    },
  };
}
