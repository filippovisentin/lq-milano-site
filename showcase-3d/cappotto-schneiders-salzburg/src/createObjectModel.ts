import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

type TaperedStation = { position: [number, number, number]; rx: number; rz: number; twist?: number };

// Frames come from PARALLEL TRANSPORT, not from a Frenet frame. A Frenet frame is defined by
// the curve's normal, which flips sign wherever the path has an inflection or straightens out,
// and every flip twists the surface 180 degrees within one segment. Carrying the previous frame
// forward and removing only its along-path component keeps the twist continuous. THREE's own
// extrudePath and TubeGeometry do not expose this, which is why this is hand-built.
function buildTaperedSweepGeometry(
  sweep: { stations: TaperedStation[]; radialSegments?: number; capEnds?: boolean },
): THREE.BufferGeometry {
  const stations = sweep.stations;
  if (stations.length < 2) throw new Error('tapered-sweep needs at least two stations');
  const radial = Math.max(3, sweep.radialSegments ?? 10);
  const centres = stations.map((s) => new THREE.Vector3(...s.position));

  const tangents = centres.map((_, i) => {
    const prev = centres[Math.max(0, i - 1)];
    const next = centres[Math.min(centres.length - 1, i + 1)];
    const t = next.clone().sub(prev);
    // Coincident neighbours would normalise to NaN and poison every downstream vertex.
    return t.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : t.normalize();
  });

  // Seed a reference axis that is not parallel to the first tangent, or the first cross
  // product is degenerate and the whole sweep collapses to a line.
  let ref = new THREE.Vector3(0, 0, 1);
  if (Math.abs(tangents[0].dot(ref)) > 0.9) ref = new THREE.Vector3(1, 0, 0);

  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  let carried = ref.clone().sub(tangents[0].clone().multiplyScalar(ref.dot(tangents[0]))).normalize();
  for (let i = 0; i < tangents.length; i += 1) {
    const t = tangents[i];
    // Project the carried frame back onto the plane perpendicular to this tangent.
    const n = carried.clone().sub(t.clone().multiplyScalar(carried.dot(t)));
    if (n.lengthSq() < 1e-12) {
      const fallback = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      n.copy(fallback.sub(t.clone().multiplyScalar(fallback.dot(t))));
    }
    n.normalize();
    normals.push(n);
    binormals.push(new THREE.Vector3().crossVectors(t, n).normalize());
    carried = n;
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringStart: number[] = [];
  const isPoint: boolean[] = [];

  for (let i = 0; i < stations.length; i += 1) {
    const st = stations[i];
    const v = i / (stations.length - 1);
    ringStart.push(positions.length / 3);
    // A station whose section has collapsed emits ONE vertex, not a ring of radius zero.
    // A degenerate ring still carries `radial` coincident vertices and `radial` zero-area
    // triangles, so the lock ends in a blunt cap the width of the floating-point noise
    // rather than at a point -- and a hair lock, a horn or a blade tip has to reach a point.
    if (st.rx <= 1e-6 && st.rz <= 1e-6) {
      isPoint.push(true);
      positions.push(centres[i].x, centres[i].y, centres[i].z);
      uvs.push(0.5, v);
      continue;
    }
    isPoint.push(false);
    const twist = ((st.twist ?? 0) * Math.PI) / 180;
    for (let j = 0; j <= radial; j += 1) {
      const theta = (j / radial) * Math.PI * 2 + twist;
      const offset = normals[i].clone().multiplyScalar(Math.cos(theta) * st.rx)
        .add(binormals[i].clone().multiplyScalar(Math.sin(theta) * st.rz));
      const p = centres[i].clone().add(offset);
      positions.push(p.x, p.y, p.z);
      uvs.push(j / radial, v);
    }
  }

  for (let i = 0; i < stations.length - 1; i += 1) {
    const a0 = ringStart[i];
    const b0 = ringStart[i + 1];
    if (isPoint[i] && isPoint[i + 1]) continue;   // two collapsed stations bound nothing
    for (let j = 0; j < radial; j += 1) {
      // Wound so the face normal points radially OUTWARD.
      //
      // Ring vertices advance from `normal` toward `binormal`, and binormal is
      // tangent x normal, so increasing theta runs counter-clockwise seen from the
      // far end of the segment. Taking the ring-to-ring edge first therefore puts
      // the cross product on the inside. Measured as signed volume on the built
      // mesh: every tapered-sweep came out negative -- a torso at -0.0674 and a
      // tail at -0.0044 against a positive ellipsoid head -- so every sweep this
      // generator has ever emitted rendered its back faces, with normals pointing
      // into the solid and every lighting judgement made on the wrong surface.
      if (isPoint[i]) indices.push(a0, b0 + j + 1, b0 + j);
      else if (isPoint[i + 1]) indices.push(a0 + j, a0 + j + 1, b0);
      else indices.push(a0 + j, a0 + j + 1, b0 + j, a0 + j + 1, b0 + j + 1, b0 + j);
    }
  }

  if (sweep.capEnds ?? true) {
    for (const end of [0, stations.length - 1]) {
      if (isPoint[end]) continue;   // a point end is already closed
      const centreIndex = positions.length / 3;
      positions.push(centres[end].x, centres[end].y, centres[end].z);
      uvs.push(0.5, end === 0 ? 0 : 1);
      const base = ringStart[end];
      for (let j = 0; j < radial; j += 1) {
        if (end === 0) indices.push(centreIndex, base + j + 1, base + j);
        else indices.push(centreIndex, base + j, base + j + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Cappotto Schneiders Salzburg
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createCappottoSchneidersSalzburgModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Cappotto Schneiders Salzburg";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "fovDegrees": 1.0, "aspect": 0.6667, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0, 0, 10], "note": "Product flat shot: orthographic front projection, frame fitted to garment bbox.", "projection": "orthographic"}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["fabric-shell"] = createSculptMaterial(
    "fabric-shell",
    {"id": "fabric-shell", "name": "Gabardine shell (stone olive satin)", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#a3a38e", "color": "#a3a38e", "albedo": {"dominant": "#a3a38e", "secondary": ["#8f8f7a", "#b4b39d"], "samplingNotes": "projected de-lit photo on front/back; palette for flanks"}, "colorVariation": {"palette": ["#a3a38e", "#8f8f7a", "#b4b39d"], "pattern": "projected-photo", "amplitude": 0.1, "heightCorrelation": 0.2}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.68, "variation": 0.1, "map": "independent-procedural-field", "localResponse": "slightly glossier on crinkle crests"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "crinkle-relief", "channel": "normal", "region": "chest and upper back", "description": "fine crease field", "strength": 0.3}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sheen": {"color": "#d8d6c4", "roughness": 0.5, "intensity": 0.35}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\fabric.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\fabric-shell\\fabric-shell_albedo.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/fabric-shell/fabric-shell_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\fabric-shell\\fabric-shell_roughness.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/fabric-shell/fabric-shell_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\fabric-shell\\fabric-shell_height.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/fabric-shell/fabric-shell_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\fabric-shell\\fabric-shell_normal.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/fabric-shell/fabric-shell_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\fabric-shell\\fabric-shell_ao.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/fabric-shell/fabric-shell_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 260, "sourceHeight": 400, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 260, "height": 400}, "mask": {"backgroundColor": "#B4B09B", "backgroundNoise": 30.1, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.1182}, "mapStats": {"valueRange": 0.5241, "heightP90Gradient": 0.0512, "roughnessBase": 0.684, "roughnessVariation": 0.086, "normalStrength": 0.216, "blurRadius": 10}, "palette": ["#868173", "#ECE9CE", "#A39C87", "#BFB99F", "#676455"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );
  materialMap["fabric-interior"] = createSculptMaterial(
    "fabric-interior",
    {"id": "fabric-interior", "name": "Shell fabric, interior in shadow", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#3f3f35", "color": "#3f3f35", "albedo": {"dominant": "#3f3f35", "secondary": ["#2e2e27"], "samplingNotes": "neck opening"}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.85, "variation": 0.05, "map": "independent-procedural-field", "localResponse": "flat"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\interior.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\fabric-interior\\fabric-interior_albedo.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/fabric-interior/fabric-interior_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\fabric-interior\\fabric-interior_roughness.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/fabric-interior/fabric-interior_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\fabric-interior\\fabric-interior_height.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/fabric-interior/fabric-interior_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\fabric-interior\\fabric-interior_normal.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/fabric-interior/fabric-interior_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\fabric-interior\\fabric-interior_ao.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/fabric-interior/fabric-interior_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 40, "sourceHeight": 30, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 40, "height": 30}, "mask": {"backgroundColor": "#605C4F", "backgroundNoise": 34.655, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.455}, "mapStats": {"valueRange": 0.3728, "heightP90Gradient": 0.0386, "roughnessBase": 0.69, "roughnessVariation": 0.061, "normalStrength": 0.201, "blurRadius": 10}, "palette": ["#48423A", "#3E3731", "#4F4A42", "#585549", "#9E9B8D"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );
  materialMap["horn-button"] = createSculptMaterial(
    "horn-button",
    {"id": "horn-button", "name": "Horn button", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#3a2a20", "color": "#3a2a20", "albedo": {"dominant": "#3a2a20", "secondary": ["#4a3528"], "samplingNotes": "top button in collar close-up"}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.4, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "polished rim"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\button.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.817, "estimatedFidelity": 0.817, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\horn-button\\horn-button_albedo.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/horn-button/horn-button_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\horn-button\\horn-button_roughness.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/horn-button/horn-button_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\horn-button\\horn-button_height.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/horn-button/horn-button_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\horn-button\\horn-button_normal.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/horn-button/horn-button_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\horn-button\\horn-button_ao.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/horn-button/horn-button_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 56, "sourceHeight": 56, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 56, "height": 56}, "mask": {"backgroundColor": "#352E30", "backgroundNoise": 15.033, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.0925}, "mapStats": {"valueRange": 0.2364, "heightP90Gradient": 0.01551, "roughnessBase": 0.68, "roughnessVariation": 0.05, "normalStrength": 0.174, "blurRadius": 10}, "palette": ["#494448", "#585257", "#201C20", "#4F4B4F", "#302C35"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}},
    options
  );
  materialMap["thread"] = createSculptMaterial(
    "thread",
    {"id": "thread", "name": "Topstitch thread", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#8d8c78", "color": "#8d8c78", "albedo": {"dominant": "#8d8c78", "secondary": [], "samplingNotes": "tone-on-tone stitching"}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.85, "variation": 0.05, "map": "independent-procedural-field", "localResponse": "flat"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\fabric.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\thread\\thread_albedo.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/thread/thread_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\thread\\thread_roughness.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/thread/thread_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\thread\\thread_height.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/thread/thread_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\thread\\thread_normal.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/thread/thread_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\pbr\\thread\\thread_ao.png", "url": "/showcase/cappotto-schneiders-salzburg/pbr/thread/thread_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 260, "sourceHeight": 400, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 260, "height": 400}, "mask": {"backgroundColor": "#B4B09B", "backgroundNoise": 30.1, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.1182}, "mapStats": {"valueRange": 0.5241, "heightP90Gradient": 0.0512, "roughnessBase": 0.684, "roughnessVariation": 0.086, "normalStrength": 0.216, "blurRadius": 10}, "palette": ["#868173", "#ECE9CE", "#A39C87", "#BFB99F", "#676455"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Body shell (front + back panels)__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Body shell (front + back panels)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.75, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "One smoothly varying draped volume from shoulder slope to A-line hem; lofted elliptical stations measured from the front mask.", "geometryDescriptor": {"topologyIntent": "smooth lofted cloth shell", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": {"stations": [{"position": [0.0, -0.455, 0.0], "rx": 0.112, "rz": 0.172, "twist": 0.0}, {"position": [0.0, -0.3, 0.0], "rx": 0.108, "rz": 0.171, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.11, "rz": 0.178, "twist": 0.0}, {"position": [0.0, 0.1, 0.0], "rx": 0.114, "rz": 0.183, "twist": 0.0}, {"position": [0.0, 0.3, 0.0], "rx": 0.108, "rz": 0.178, "twist": 0.0}, {"position": [0.0, 0.38, 0.0], "rx": 0.096, "rz": 0.163, "twist": 0.0}, {"position": [0.0, 0.41, 0.0], "rx": 0.075, "rz": 0.105, "twist": 0.0}, {"position": [0.0, 0.428, 0.0], "rx": 0.056, "rz": 0.064, "twist": 0.0}], "radialSegments": 48, "capEnds": true}}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "garment-height", "confidence": 0.75}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}}, "material": "fabric-shell", "materialLayers": ["fabric-shell"], "deformations": [], "joints": [], "seams": [{"id": "side-seam", "path": "lateral, underarm to hem"}, {"id": "centre-back-seam", "path": "nape to vent"}], "localFeatures": [{"id": "raglan-seams", "type": "seam-line", "description": "raglan seams neck->underarm, back view", "evidenceRefs": ["back-view"]}, {"id": "crinkle-relief", "type": "normal-relief", "description": "fine crease field on chest and back", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "root", "dominantAlbedo": "rgba(130, 126, 111, 1.0)", "secondaryAlbedo": "rgba(176, 169, 147, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.294, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\fabric.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.396}}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.455, 0.0], "rx": 0.112, "rz": 0.172, "twist": 0.0}, {"position": [0.0, -0.3, 0.0], "rx": 0.108, "rz": 0.171, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.11, "rz": 0.178, "twist": 0.0}, {"position": [0.0, 0.1, 0.0], "rx": 0.114, "rz": 0.183, "twist": 0.0}, {"position": [0.0, 0.3, 0.0], "rx": 0.108, "rz": 0.178, "twist": 0.0}, {"position": [0.0, 0.38, 0.0], "rx": 0.096, "rz": 0.163, "twist": 0.0}, {"position": [0.0, 0.41, 0.0], "rx": 0.075, "rz": 0.105, "twist": 0.0}, {"position": [0.0, 0.428, 0.0], "rx": 0.056, "rz": 0.064, "twist": 0.0}], "radialSegments": 48, "capEnds": true});
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["fabric-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Body shell (front + back panels)";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Body shell (front + back panels)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.75, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "One smoothly varying draped volume from shoulder slope to A-line hem; lofted elliptical stations measured from the front mask.", "geometryDescriptor": {"topologyIntent": "smooth lofted cloth shell", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": {"stations": [{"position": [0.0, -0.455, 0.0], "rx": 0.112, "rz": 0.172, "twist": 0.0}, {"position": [0.0, -0.3, 0.0], "rx": 0.108, "rz": 0.171, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.11, "rz": 0.178, "twist": 0.0}, {"position": [0.0, 0.1, 0.0], "rx": 0.114, "rz": 0.183, "twist": 0.0}, {"position": [0.0, 0.3, 0.0], "rx": 0.108, "rz": 0.178, "twist": 0.0}, {"position": [0.0, 0.38, 0.0], "rx": 0.096, "rz": 0.163, "twist": 0.0}, {"position": [0.0, 0.41, 0.0], "rx": 0.075, "rz": 0.105, "twist": 0.0}, {"position": [0.0, 0.428, 0.0], "rx": 0.056, "rz": 0.064, "twist": 0.0}], "radialSegments": 48, "capEnds": true}}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "garment-height", "confidence": 0.75}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}}, "material": "fabric-shell", "materialLayers": ["fabric-shell"], "deformations": [], "joints": [], "seams": [{"id": "side-seam", "path": "lateral, underarm to hem"}, {"id": "centre-back-seam", "path": "nape to vent"}], "localFeatures": [{"id": "raglan-seams", "type": "seam-line", "description": "raglan seams neck->underarm, back view", "evidenceRefs": ["back-view"]}, {"id": "crinkle-relief", "type": "normal-relief", "description": "fine crease field on chest and back", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "root", "dominantAlbedo": "rgba(130, 126, 111, 1.0)", "secondaryAlbedo": "rgba(176, 169, 147, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.294, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\fabric.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.396}}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_sleeve_l_1 = makeAttachmentEndpoint(null);
  const node_sleeve_l_1 = new THREE.Group();
  node_sleeve_l_1.name = "Raglan sleeve (wearer left)__pivot";
  node_sleeve_l_1.scale.set(1, 1, 1);
  if (endpoint_sleeve_l_1) {
    node_sleeve_l_1.position.copy(endpoint_sleeve_l_1.start);
    node_sleeve_l_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sleeve_l_1.position.set(0.0, 0.0, 0.0);
    node_sleeve_l_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_sleeve_l_1.userData.sculptComponent = {"id": "sleeve-l", "name": "Raglan sleeve (wearer left)", "level": "macro", "role": "sleeve", "importance": 0.85, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Tapered fabric tube hanging from the raglan shoulder, cuff narrower than upper arm.", "geometryDescriptor": {"topologyIntent": "smooth lofted cloth shell", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": {"stations": [{"position": [0.07, 0.405, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0}, {"position": [0.115, 0.355, 0.0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [0.16, 0.3, 0.002], "rx": 0.056, "rz": 0.066, "twist": 0.0}, {"position": [0.186, 0.22, 0.006], "rx": 0.052, "rz": 0.06, "twist": 0.0}, {"position": [0.204, 0.1, 0.012], "rx": 0.045, "rz": 0.05, "twist": 0.0}, {"position": [0.216, -0.04, 0.018], "rx": 0.04, "rz": 0.043, "twist": 0.0}, {"position": [0.224, -0.175, 0.022], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 24, "capEnds": true}}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "garment-height", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "secondary-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}}, "material": "fabric-shell", "materialLayers": ["fabric-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "sleeve-l", "dominantAlbedo": "rgba(130, 126, 111, 1.0)", "secondaryAlbedo": "rgba(176, 169, 147, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.294, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\fabric.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.396}}};
  node_sleeve_l_1.userData.actionProfile = {"animationRole": "secondary-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}};
  (nodes["root"] ?? root).add(node_sleeve_l_1);
  nodes["sleeve-l"] = node_sleeve_l_1;
  const mesh_sleeve_l_1Geometry = endpoint_sleeve_l_1
    ? new THREE.CylinderGeometry(endpoint_sleeve_l_1.endRadius, endpoint_sleeve_l_1.baseRadius, endpoint_sleeve_l_1.length, 32, 12)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.07, 0.405, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0}, {"position": [0.115, 0.355, 0.0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [0.16, 0.3, 0.002], "rx": 0.056, "rz": 0.066, "twist": 0.0}, {"position": [0.186, 0.22, 0.006], "rx": 0.052, "rz": 0.06, "twist": 0.0}, {"position": [0.204, 0.1, 0.012], "rx": 0.045, "rz": 0.05, "twist": 0.0}, {"position": [0.216, -0.04, 0.018], "rx": 0.04, "rz": 0.043, "twist": 0.0}, {"position": [0.224, -0.175, 0.022], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 24, "capEnds": true});
  if (!endpoint_sleeve_l_1) {
    mesh_sleeve_l_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_sleeve_l_1 = new THREE.Mesh(
    mesh_sleeve_l_1Geometry,
    materialMap["fabric-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sleeve_l_1.name = "Raglan sleeve (wearer left)";
  if (endpoint_sleeve_l_1) {
    mesh_sleeve_l_1.position.copy(endpoint_sleeve_l_1.midpoint);
    mesh_sleeve_l_1.quaternion.copy(endpoint_sleeve_l_1.quaternion);
  }
  mesh_sleeve_l_1.castShadow = options.castShadow ?? true;
  mesh_sleeve_l_1.receiveShadow = options.receiveShadow ?? true;
  mesh_sleeve_l_1.userData.sculptComponent = {"id": "sleeve-l", "name": "Raglan sleeve (wearer left)", "level": "macro", "role": "sleeve", "importance": 0.85, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Tapered fabric tube hanging from the raglan shoulder, cuff narrower than upper arm.", "geometryDescriptor": {"topologyIntent": "smooth lofted cloth shell", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": {"stations": [{"position": [0.07, 0.405, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0}, {"position": [0.115, 0.355, 0.0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [0.16, 0.3, 0.002], "rx": 0.056, "rz": 0.066, "twist": 0.0}, {"position": [0.186, 0.22, 0.006], "rx": 0.052, "rz": 0.06, "twist": 0.0}, {"position": [0.204, 0.1, 0.012], "rx": 0.045, "rz": 0.05, "twist": 0.0}, {"position": [0.216, -0.04, 0.018], "rx": 0.04, "rz": 0.043, "twist": 0.0}, {"position": [0.224, -0.175, 0.022], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 24, "capEnds": true}}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "garment-height", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "secondary-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}}, "material": "fabric-shell", "materialLayers": ["fabric-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "sleeve-l", "dominantAlbedo": "rgba(130, 126, 111, 1.0)", "secondaryAlbedo": "rgba(176, 169, 147, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.294, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\fabric.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.396}}};
  node_sleeve_l_1.add(mesh_sleeve_l_1);
  meshes["sleeve-l"] = mesh_sleeve_l_1;
  colliders["sleeve-l"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["sleeve-l"] ??= [];
  destructionGroups["sleeve-l"].push(node_sleeve_l_1);

  const endpoint_sleeve_r_2 = makeAttachmentEndpoint(null);
  const node_sleeve_r_2 = new THREE.Group();
  node_sleeve_r_2.name = "Raglan sleeve (wearer right)__pivot";
  node_sleeve_r_2.scale.set(1, 1, 1);
  if (endpoint_sleeve_r_2) {
    node_sleeve_r_2.position.copy(endpoint_sleeve_r_2.start);
    node_sleeve_r_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sleeve_r_2.position.set(0.0, 0.0, 0.0);
    node_sleeve_r_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_sleeve_r_2.userData.sculptComponent = {"id": "sleeve-r", "name": "Raglan sleeve (wearer right)", "level": "macro", "role": "sleeve", "importance": 0.85, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Tapered fabric tube hanging from the raglan shoulder, cuff narrower than upper arm.", "geometryDescriptor": {"topologyIntent": "smooth lofted cloth shell", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": {"stations": [{"position": [-0.07, 0.405, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0}, {"position": [-0.115, 0.355, 0.0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [-0.16, 0.3, 0.002], "rx": 0.056, "rz": 0.066, "twist": 0.0}, {"position": [-0.186, 0.22, 0.006], "rx": 0.052, "rz": 0.06, "twist": 0.0}, {"position": [-0.204, 0.1, 0.012], "rx": 0.045, "rz": 0.05, "twist": 0.0}, {"position": [-0.216, -0.04, 0.018], "rx": 0.04, "rz": 0.043, "twist": 0.0}, {"position": [-0.224, -0.175, 0.022], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 24, "capEnds": true}}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "garment-height", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "secondary-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}}, "material": "fabric-shell", "materialLayers": ["fabric-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "sleeve-r", "dominantAlbedo": "rgba(130, 126, 111, 1.0)", "secondaryAlbedo": "rgba(176, 169, 147, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.294, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\fabric.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.396}}};
  node_sleeve_r_2.userData.actionProfile = {"animationRole": "secondary-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}};
  (nodes["root"] ?? root).add(node_sleeve_r_2);
  nodes["sleeve-r"] = node_sleeve_r_2;
  const mesh_sleeve_r_2Geometry = endpoint_sleeve_r_2
    ? new THREE.CylinderGeometry(endpoint_sleeve_r_2.endRadius, endpoint_sleeve_r_2.baseRadius, endpoint_sleeve_r_2.length, 32, 12)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.07, 0.405, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0}, {"position": [-0.115, 0.355, 0.0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [-0.16, 0.3, 0.002], "rx": 0.056, "rz": 0.066, "twist": 0.0}, {"position": [-0.186, 0.22, 0.006], "rx": 0.052, "rz": 0.06, "twist": 0.0}, {"position": [-0.204, 0.1, 0.012], "rx": 0.045, "rz": 0.05, "twist": 0.0}, {"position": [-0.216, -0.04, 0.018], "rx": 0.04, "rz": 0.043, "twist": 0.0}, {"position": [-0.224, -0.175, 0.022], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 24, "capEnds": true});
  if (!endpoint_sleeve_r_2) {
    mesh_sleeve_r_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_sleeve_r_2 = new THREE.Mesh(
    mesh_sleeve_r_2Geometry,
    materialMap["fabric-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sleeve_r_2.name = "Raglan sleeve (wearer right)";
  if (endpoint_sleeve_r_2) {
    mesh_sleeve_r_2.position.copy(endpoint_sleeve_r_2.midpoint);
    mesh_sleeve_r_2.quaternion.copy(endpoint_sleeve_r_2.quaternion);
  }
  mesh_sleeve_r_2.castShadow = options.castShadow ?? true;
  mesh_sleeve_r_2.receiveShadow = options.receiveShadow ?? true;
  mesh_sleeve_r_2.userData.sculptComponent = {"id": "sleeve-r", "name": "Raglan sleeve (wearer right)", "level": "macro", "role": "sleeve", "importance": 0.85, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Tapered fabric tube hanging from the raglan shoulder, cuff narrower than upper arm.", "geometryDescriptor": {"topologyIntent": "smooth lofted cloth shell", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": {"stations": [{"position": [-0.07, 0.405, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0}, {"position": [-0.115, 0.355, 0.0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [-0.16, 0.3, 0.002], "rx": 0.056, "rz": 0.066, "twist": 0.0}, {"position": [-0.186, 0.22, 0.006], "rx": 0.052, "rz": 0.06, "twist": 0.0}, {"position": [-0.204, 0.1, 0.012], "rx": 0.045, "rz": 0.05, "twist": 0.0}, {"position": [-0.216, -0.04, 0.018], "rx": 0.04, "rz": 0.043, "twist": 0.0}, {"position": [-0.224, -0.175, 0.022], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 24, "capEnds": true}}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "garment-height", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "secondary-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}}, "material": "fabric-shell", "materialLayers": ["fabric-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "sleeve-r", "dominantAlbedo": "rgba(130, 126, 111, 1.0)", "secondaryAlbedo": "rgba(176, 169, 147, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.294, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\fabric.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.396}}};
  node_sleeve_r_2.add(mesh_sleeve_r_2);
  meshes["sleeve-r"] = mesh_sleeve_r_2;
  colliders["sleeve-r"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["sleeve-r"] ??= [];
  destructionGroups["sleeve-r"].push(node_sleeve_r_2);

  const endpoint_collar_stand_3 = makeAttachmentEndpoint(null);
  const node_collar_stand_3 = new THREE.Group();
  node_collar_stand_3.name = "Collar stand band__pivot";
  node_collar_stand_3.scale.set(1, 1, 1);
  if (endpoint_collar_stand_3) {
    node_collar_stand_3.position.copy(endpoint_collar_stand_3.start);
    node_collar_stand_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_collar_stand_3.position.set(0.0, 0.0, 0.0);
    node_collar_stand_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_collar_stand_3.userData.sculptComponent = {"id": "collar-stand", "name": "Collar stand band", "level": "macro", "role": "collar", "importance": 0.7, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Short band wrapping the neck opening, open at centre front.", "geometryDescriptor": {"topologyIntent": "smooth lofted cloth shell", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": {"stations": [{"position": [-0.04, 0.436, 0.052], "rx": 0.006, "rz": 0.007, "twist": 0}, {"position": [-0.064, 0.442, 0.01], "rx": 0.006, "rz": 0.013, "twist": 0}, {"position": [-0.05, 0.446, -0.04], "rx": 0.006, "rz": 0.016, "twist": 0}, {"position": [0.0, 0.448, -0.058], "rx": 0.006, "rz": 0.017, "twist": 0}, {"position": [0.05, 0.446, -0.04], "rx": 0.006, "rz": 0.016, "twist": 0}, {"position": [0.064, 0.442, 0.01], "rx": 0.006, "rz": 0.013, "twist": 0}, {"position": [0.04, 0.436, 0.052], "rx": 0.006, "rz": 0.007, "twist": 0}], "radialSegments": 12, "capEnds": true}}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "garment-height", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "collar-stand", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}}, "material": "fabric-shell", "materialLayers": ["fabric-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "collar-stand", "dominantAlbedo": "rgba(130, 126, 111, 1.0)", "secondaryAlbedo": "rgba(176, 169, 147, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.294, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\fabric.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.396}}};
  node_collar_stand_3.userData.actionProfile = {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "collar-stand", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}};
  (nodes["root"] ?? root).add(node_collar_stand_3);
  nodes["collar-stand"] = node_collar_stand_3;
  const mesh_collar_stand_3Geometry = endpoint_collar_stand_3
    ? new THREE.CylinderGeometry(endpoint_collar_stand_3.endRadius, endpoint_collar_stand_3.baseRadius, endpoint_collar_stand_3.length, 32, 12)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.04, 0.436, 0.052], "rx": 0.006, "rz": 0.007, "twist": 0}, {"position": [-0.064, 0.442, 0.01], "rx": 0.006, "rz": 0.013, "twist": 0}, {"position": [-0.05, 0.446, -0.04], "rx": 0.006, "rz": 0.016, "twist": 0}, {"position": [0.0, 0.448, -0.058], "rx": 0.006, "rz": 0.017, "twist": 0}, {"position": [0.05, 0.446, -0.04], "rx": 0.006, "rz": 0.016, "twist": 0}, {"position": [0.064, 0.442, 0.01], "rx": 0.006, "rz": 0.013, "twist": 0}, {"position": [0.04, 0.436, 0.052], "rx": 0.006, "rz": 0.007, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_collar_stand_3) {
    mesh_collar_stand_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_collar_stand_3 = new THREE.Mesh(
    mesh_collar_stand_3Geometry,
    materialMap["fabric-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_collar_stand_3.name = "Collar stand band";
  if (endpoint_collar_stand_3) {
    mesh_collar_stand_3.position.copy(endpoint_collar_stand_3.midpoint);
    mesh_collar_stand_3.quaternion.copy(endpoint_collar_stand_3.quaternion);
  }
  mesh_collar_stand_3.castShadow = options.castShadow ?? true;
  mesh_collar_stand_3.receiveShadow = options.receiveShadow ?? true;
  mesh_collar_stand_3.userData.sculptComponent = {"id": "collar-stand", "name": "Collar stand band", "level": "macro", "role": "collar", "importance": 0.7, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Short band wrapping the neck opening, open at centre front.", "geometryDescriptor": {"topologyIntent": "smooth lofted cloth shell", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": {"stations": [{"position": [-0.04, 0.436, 0.052], "rx": 0.006, "rz": 0.007, "twist": 0}, {"position": [-0.064, 0.442, 0.01], "rx": 0.006, "rz": 0.013, "twist": 0}, {"position": [-0.05, 0.446, -0.04], "rx": 0.006, "rz": 0.016, "twist": 0}, {"position": [0.0, 0.448, -0.058], "rx": 0.006, "rz": 0.017, "twist": 0}, {"position": [0.05, 0.446, -0.04], "rx": 0.006, "rz": 0.016, "twist": 0}, {"position": [0.064, 0.442, 0.01], "rx": 0.006, "rz": 0.013, "twist": 0}, {"position": [0.04, 0.436, 0.052], "rx": 0.006, "rz": 0.007, "twist": 0}], "radialSegments": 12, "capEnds": true}}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "garment-height", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "collar-stand", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-shell"}}, "material": "fabric-shell", "materialLayers": ["fabric-shell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "collar-stand", "dominantAlbedo": "rgba(130, 126, 111, 1.0)", "secondaryAlbedo": "rgba(176, 169, 147, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.294, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\Users\\filip\\Desktop\\LQ-Milano-Handoff\\site\\showcase-3d\\cappotto-schneiders-salzburg\\crops\\fabric.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.396}}};
  node_collar_stand_3.add(mesh_collar_stand_3);
  meshes["collar-stand"] = mesh_collar_stand_3;
  colliders["collar-stand"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["collar-stand"] ??= [];
  destructionGroups["collar-stand"].push(node_collar_stand_3);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createCappottoSchneidersSalzburgLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Cappotto Schneiders Salzburg look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "directional", "direction": [0.25, 0.85, 0.45], "intensity": 2.4, "color": "#fff6e8", "evidence": "soft top-front studio light: brighter shoulders, darker hem"}, {"id": "fill", "type": "hemisphere", "skyColor": "#fffaf0", "groundColor": "#b8a890", "intensity": 0.9, "evidence": "white sweep bounce"}, {"id": "rim", "type": "directional", "direction": [-0.6, 0.3, -0.7], "intensity": 1.1, "color": "#ffd9b0", "evidence": "site viewer neon rim accent"}, {"id": "environment", "type": "environment", "preset": "RoomEnvironment", "intensity": 0.6, "evidence": "neutral studio reflections for satin sheen"}, {"id": "exposure", "type": "tone-mapping", "toneMapping": "ACESFilmic", "exposure": 1.05, "notes": "ACES filmic tone mapping, exposure 1.05; contact shadow: soft ground shadow ellipse under the hem plus ambient occlusion in creases"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createCappottoSchneidersSalzburgEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameCappottoSchneidersSalzburgCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createCappottoSchneidersSalzburgPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureCappottoSchneidersSalzburgRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createCappottoSchneidersSalzburgInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
