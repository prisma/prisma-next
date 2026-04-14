export interface RuntimeErrorEnvelope extends Error {
  readonly code: string;
  readonly category: 'PLAN' | 'CONTRACT' | 'LINT' | 'BUDGET' | 'RUNTIME';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

export function runtimeError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): RuntimeErrorEnvelope {
  const error = new Error(message) as RuntimeErrorEnvelope;
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });

  return Object.assign(error, {
    code,
    category: resolveCategory(code),
    severity: 'error' as const,
    message,
    details,
  });
}

function resolveCategory(code: string): RuntimeErrorEnvelope['category'] {
  const prefix = code.split('.')[0] ?? 'RUNTIME';
  switch (prefix) {
    case 'PLAN':
    case 'CONTRACT':
    case 'LINT':
    case 'BUDGET':
      return prefix;
    default:
      return 'RUNTIME';
  }
}
