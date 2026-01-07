import type { RuntimeError } from './types.ts';

export function planInvalid(
  message: string,
  details?: Record<string, unknown>,
  hints?: readonly string[],
  docs?: readonly string[],
): RuntimeError {
  const error = new Error(message) as RuntimeError;

  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });

  return Object.assign(error, {
    code: 'PLAN.INVALID',
    category: 'PLAN' as const,
    severity: 'error' as const,
    details,
    hints,
    docs,
  });
}

export function planUnsupported(
  message: string,
  details?: Record<string, unknown>,
  hints?: readonly string[],
  docs?: readonly string[],
): RuntimeError {
  const error = new Error(message) as RuntimeError;

  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });

  return Object.assign(error, {
    code: 'PLAN.UNSUPPORTED',
    category: 'PLAN' as const,
    severity: 'error' as const,
    details,
    hints,
    docs,
  });
}
