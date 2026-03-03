import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import { type BuiltinGeneratorId, idGenerators } from './generators';

export function generateId(spec: GeneratedValueSpec): string {
  const generator = idGenerators[spec.id as BuiltinGeneratorId];
  if (!generator) {
    throw new Error(`Unknown built-in ID generator "${spec.id}".`);
  }
  return generator(spec.params);
}
