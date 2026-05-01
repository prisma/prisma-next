export interface RuntimeErrorEnvelope extends Error {
  readonly code: string;
  readonly category: 'PLAN' | 'CONTRACT' | 'LINT' | 'BUDGET' | 'RUNTIME';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

/**
 * Stable code emitted by the runtime when an in-flight `execute()`
 * is cancelled via the per-query `AbortSignal`. The envelope's
 * `details.phase` distinguishes where the abort was observed:
 *
 * - `'encode'` — abort fired during `encodeParams` (SQL) or
 *   `resolveValue` (Mongo).
 * - `'decode'` — abort fired during `decodeRow` / `decodeField`.
 * - `'stream'` — abort fired between rows or before any codec call
 *   (already-aborted at entry).
 */
export const RUNTIME_ABORTED = 'RUNTIME.ABORTED' as const;

/** Discriminator placed in `details.phase` of a `RUNTIME.ABORTED` envelope. */
export type RuntimeAbortedPhase = 'encode' | 'decode' | 'stream';

/**
 * Type guard for the runtime-error envelope produced by `runtimeError`.
 *
 * Prefer this over duck-typing on `error.code` directly so consumers stay
 * insulated from the envelope's internal shape.
 */
export function isRuntimeError(error: unknown): error is RuntimeErrorEnvelope {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    'category' in error &&
    'severity' in error
  );
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

/**
 * Construct a `RUNTIME.ABORTED` envelope. Phase distinguishes where the
 * abort was observed (encode / decode / stream); cause carries `signal.reason`
 * verbatim from the platform — native abort produces a `DOMException`,
 * explicit `controller.abort(reason)` produces whatever the caller passed.
 * No synthesis happens here.
 */
export function runtimeAborted(phase: RuntimeAbortedPhase, cause?: unknown): RuntimeErrorEnvelope {
  const envelope = runtimeError(RUNTIME_ABORTED, `Operation aborted during ${phase}`, { phase });
  return Object.assign(envelope, { cause });
}
