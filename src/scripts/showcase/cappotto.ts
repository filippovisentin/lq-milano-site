import {
  createCappottoSchneidersSalzburgModel as createModel,
  createCappottoSchneidersSalzburgLookDevLights as createLights,
} from '../../../showcase-3d/cappotto-schneiders-salzburg/src/createObjectModel';
import type { ShowcaseOptions, Showcase } from './index';

export async function build(_o: ShowcaseOptions): Promise<Showcase> {
  const model = createModel({ qualityPriority: 'reference-fidelity' });
  const lights = createLights('reference');
  return { model, lights };
}
