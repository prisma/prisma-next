import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import { idGenerators } from './generators';

export function generateId(spec: GeneratedValueSpec): string {
  const generator = idGenerators[spec.id];
  return generator(spec.params);
}
