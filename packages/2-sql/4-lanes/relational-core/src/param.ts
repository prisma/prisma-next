import { planInvalid } from '@prisma-next/plan';
import type { ParamPlaceholder } from './types.ts';

export type Parameter = ParamPlaceholder;

export function param(name: string): Parameter {
  if (typeof name !== 'string' || name.length === 0) {
    throw planInvalid('Parameter name must be a non-empty string');
  }

  return Object.freeze({
    kind: 'param-placeholder' as const,
    name,
  }) satisfies Parameter;
}
