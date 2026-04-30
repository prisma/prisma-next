import type { RuntimeAbortedPhase } from '@prisma-next/framework-components/runtime';
import { runtimeAborted } from '@prisma-next/framework-components/runtime';

/**
 * Race a per-cell `Promise.all` against the supplied abort signal so that
 * the runtime returns `RUNTIME.ABORTED` promptly even when codec bodies
 * ignore the signal. In-flight bodies that ignore the signal are abandoned
 * and run to completion in the background — the cooperative-cancellation
 * contract documented in ADR 204.
 *
 * The call site MUST pre-check `signal.aborted` and short-circuit before
 * invoking this helper; this function assumes the signal is not already
 * aborted on entry. (It still installs an `abort` listener and would fire
 * synchronously if the signal aborted between pre-check and listener
 * registration, which is a harmless edge: the rejection is still attributed
 * to the abort path.)
 *
 * Distinguishing the rejection source is load-bearing for AC-ERR4
 * (`RUNTIME.ENCODE_FAILED` / `RUNTIME.DECODE_FAILED` pass through
 * unchanged). The semantically equivalent `abortable(signal)` helper in
 * `@prisma-next/utils` rejects with `signal.reason ?? new DOMException(...)`,
 * which is not stably distinguishable from a codec-thrown error by identity
 * alone (a fresh fallback DOMException is allocated per call). We instead
 * track abort attribution with a unique sentinel: only the `onAbort`
 * listener installed here ever rejects with the sentinel, so an
 * `error === sentinel` identity check after the race is unambiguous.
 */
export async function raceAgainstAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
  phase: RuntimeAbortedPhase,
): Promise<T> {
  const sentinel: { reason: unknown } = { reason: undefined };
  let onAbort: (() => void) | undefined;

  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => {
      sentinel.reason = signal.reason;
      reject(sentinel);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([work, abortPromise]);
  } catch (error) {
    if (error === sentinel) {
      throw runtimeAborted(phase, sentinel.reason);
    }
    throw error;
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
