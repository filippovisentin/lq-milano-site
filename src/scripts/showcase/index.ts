// Hand-built showcase garments (img2threejs pipeline, sources in showcase-3d/<slug>/).
// Each entry lazily loads its generated factory; `pass` lets the review page
// show the bare factory ('blockout') or the finished look ('final').
import type * as THREE from 'three';

export interface ShowcaseOptions { pass?: string }
export interface Showcase { model: THREE.Group; lights: THREE.Group }

const registry: Record<string, (o: ShowcaseOptions) => Promise<Showcase>> = {
  'cappotto-schneiders-salzburg': async (o) => (await import('./cappotto')).build(o),
};

export const hasShowcase = (slug: string) => slug in registry;
export async function mountShowcase(slug: string, o: ShowcaseOptions = {}): Promise<Showcase> {
  const f = registry[slug];
  if (!f) throw new Error(`no showcase model for ${slug}`);
  return f(o);
}
