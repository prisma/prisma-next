import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import type { BuiltinGeneratorId } from './generator-ids';
import { idGenerators } from './generators';

function isBuiltinGeneratorId(id: string): id is BuiltinGeneratorId {
  return Object.hasOwn(idGenerators, id);
}

export function generateId(spec: GeneratedValueSpec): string {
  if (!isBuiltinGeneratorId(spec.id)) {
    throw new Error(`Unknown built-in ID generator "${spec.id}".`);
  }
  return idGenerators[spec.id](spec.params);
}
