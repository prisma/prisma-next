/**
 * Cipherstash-internal `RUNTIME.ABORTED` phase wrapping.
 *
 * The framework`s `runtimeAborted(phase)` (`@prisma-next/framework-
 * components/runtime`) constructs the canonical `RUNTIME.ABORTED`
 * envelope (`code === 'RUNTIME.ABORTED'`, `category === 'RUNTIME'`,
 * `details.phase`, `cause`) but its `phase` parameter is typed as
 * the framework`s closed `RuntimeAbortedPhase` union — `encode`,
 * `decode`, `stream`, `beforeExecute`, `afterExecute`, `onRow`. Those
 * tags describe phases of `runtime.execute()` itself (see ADR 207`s
 * "Where the runtime observes abort" table); cipherstash`s async
 * observation points sit one layer outside the framework runtime:
 *
 *   - `bulk-encrypt`  — the bulk-encrypt middleware`s SDK round-trip
 *     inside `beforeExecute`. Conceptually a sub-phase of the
 *     framework`s `beforeExecute`, but tag-wise distinct so callers
 *     can attribute the abort to the cipherstash SDK call rather
 *     than to a generic middleware step.
 *   - `decrypt`       — the single-cell `EncryptedString#decrypt()`
 *     SDK call, invoked by the application after the framework
 *     returns the row. Not inside any framework phase.
 *   - `decrypt-all`   — the `decryptAll` walker`s `bulkDecrypt` calls,
 *     invoked by the application after the framework returns the
 *     row set. Not inside any framework phase.
 *
 * Rather than widen the framework union (which would conflate
 * extension-specific tags with the framework`s own attribution
 * sites), this module reuses the framework`s `runtimeError(...)`
 * envelope builder directly — the *envelope shape* (the
 * `RuntimeErrorEnvelope` interface, the `code` slot, the `category`
 * slot, the `details.phase` slot, the `cause` field) is unchanged;
 * only the set of legal `phase` string values grows. ADR 027`s
 * envelope contract is preserved bit-for-bit.
 *
 * The `raceCipherstashAbort` helper mirrors framework
 * `raceAgainstAbort` so cipherstash`s SDK-call sites get the same
 * "return promptly even when the SDK ignores the signal" behaviour
 * (the cooperative-cancellation model from ADR 207). Identity-
 * checked sentinel rejection distinguishes abort-source from a
 * codec-thrown envelope, matching the framework`s pattern. We
 * duplicate the logic (rather than passing a cast tag to the
 * framework helper) to keep the cipherstash `phase` strings
 * cipherstash-internal — no widening of the framework union.
 */

import type { RuntimeErrorEnvelope } from '@prisma-next/framework-components/runtime';
import { RUNTIME_ABORTED, runtimeError } from '@prisma-next/framework-components/runtime';

/** Discriminator placed in `details.phase` of cipherstash-issued aborts. */
export type CipherstashAbortPhase = 'bulk-encrypt' | 'decrypt' | 'decrypt-all';

/**
 * Construct a `RUNTIME.ABORTED` envelope tagged with a cipherstash
 * phase. Reuses the framework`s `runtimeError(RUNTIME_ABORTED, ...)`
 * envelope builder so the structural shape (`code`, `category`,
 * `severity`, `message`, `details.phase`, `cause`) matches everything
 * else the framework emits. Only the `phase` string set is
 * cipherstash-specific.
 */
export function cipherstashAborted(
  phase: CipherstashAbortPhase,
  cause?: unknown,
): RuntimeErrorEnvelope {
  const envelope = runtimeError(RUNTIME_ABORTED, `Operation aborted during ${phase}`, { phase });
  return Object.assign(envelope, { cause });
}

/**
 * Pre-check helper: throw a cipherstash-tagged `RUNTIME.ABORTED`
 * envelope if the supplied signal is already aborted at the call
 * site. Mirrors framework `checkAborted` (which is typed against the
 * framework`s phase union) — used to short-circuit the bulk-encrypt
 * middleware`s pre-flight, the single-cell `decrypt()` pre-flight,
 * and the `decryptAll` walker`s pre-flight before any SDK round-trip
 * is scheduled.
 */
export function checkCipherstashAborted(
  signal: AbortSignal | undefined,
  phase: CipherstashAbortPhase,
): void {
  if (signal?.aborted) {
    throw cipherstashAborted(phase, signal.reason);
  }
}

/**
 * Race a cipherstash SDK promise against the supplied `AbortSignal`
 * so the awaiting caller is rejected promptly with a
 * `RUNTIME.ABORTED` envelope as soon as the signal aborts — even
 * when the SDK body itself ignores the signal. Cooperative
 * cancellation: in-flight SDK calls that ignore the signal continue
 * running in the background and complete; the abort-attributed
 * rejection is what the cipherstash caller sees (the SDK`s eventual
 * resolution is silently abandoned per ADR 207`s "cooperative
 * cancellation, not termination" contract).
 *
 * Mirrors framework `raceAgainstAbort` line-for-line aside from the
 * cipherstash-typed phase parameter and the cipherstash-tagged
 * envelope construction. The sentinel-identity attribution is
 * load-bearing for the same reason ADR 207 spells out: a codec /
 * SDK that itself throws a `RUNTIME.ENCODE_FAILED` /
 * `RUNTIME.DECODE_FAILED` (or any other named envelope) must pass
 * through unchanged — only the cipherstash-installed listener ever
 * rejects with the local sentinel reference, so an `error ===
 * sentinel` identity check after the race is unambiguous.
 */
export async function raceCipherstashAbort<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  phase: CipherstashAbortPhase,
): Promise<T> {
  if (signal === undefined) {
    return await work;
  }
  const sentinel: { reason: unknown } = { reason: undefined };
  let onAbort: (() => void) | undefined;

  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      sentinel.reason = signal.reason;
      reject(sentinel);
      return;
    }
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
      throw cipherstashAborted(phase, sentinel.reason);
    }
    throw error;
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
