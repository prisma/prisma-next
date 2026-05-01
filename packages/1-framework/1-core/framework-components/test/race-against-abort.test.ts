import { describe, expect, it } from 'vitest';
import { raceAgainstAbort } from '../src/execution/race-against-abort';
import { isRuntimeError, runtimeError } from '../src/runtime-error';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('raceAgainstAbort', () => {
  it('resolves with the work value when the work settles before abort', async () => {
    const controller = new AbortController();
    const result = await raceAgainstAbort(Promise.resolve('ok'), controller.signal, 'encode');
    expect(result).toBe('ok');
  });

  it('throws RUNTIME.ABORTED tagged with the supplied phase when the signal aborts mid-flight', async () => {
    const controller = new AbortController();
    const reason = new Error('mid-flight');
    const work = deferred<string>();

    const racing = raceAgainstAbort(work.promise, controller.signal, 'decode');

    queueMicrotask(() => controller.abort(reason));

    await expect(racing).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'decode' },
      cause: reason,
    });

    work.resolve('late');
  });

  it('uses signal.reason verbatim as the RUNTIME.ABORTED `cause`', async () => {
    const controller = new AbortController();
    const reason = { kind: 'custom-reason' };
    const work = deferred<string>();

    const racing = raceAgainstAbort(work.promise, controller.signal, 'encode');
    queueMicrotask(() => controller.abort(reason));

    const error = await racing.catch((e: unknown) => e);
    expect((error as { cause?: unknown }).cause).toBe(reason);

    work.resolve('late');
  });

  it('passes RUNTIME.* envelopes from the work through unchanged when the work rejects first (AC-ERR4)', async () => {
    // Codec body throws RUNTIME.ENCODE_FAILED. The race must not rewrap it as
    // RUNTIME.ABORTED even if the signal happens to abort later.
    const codecError = runtimeError('RUNTIME.ENCODE_FAILED', 'codec body threw', {
      codec: 'test/x@1',
    });
    const controller = new AbortController();

    const racing = raceAgainstAbort(Promise.reject(codecError), controller.signal, 'encode');

    const error = (await racing.catch((e: unknown) => e)) as Error;
    expect(error).toBe(codecError);
    expect(isRuntimeError(error)).toBe(true);
    expect((error as Error & { code: string }).code).toBe('RUNTIME.ENCODE_FAILED');
  });

  it('passes plain (non-RUNTIME) errors from the work through unchanged when the work rejects first', async () => {
    const codecError = new TypeError('boom');
    const controller = new AbortController();

    const racing = raceAgainstAbort(Promise.reject(codecError), controller.signal, 'encode');

    await expect(racing).rejects.toBe(codecError);
  });

  it('removes the abort listener after the race settles (no leak when the work wins)', async () => {
    const controller = new AbortController();
    const tracker = trackAbortListeners(controller.signal);
    await raceAgainstAbort(Promise.resolve(1), controller.signal, 'encode');
    expect(tracker.added).toHaveLength(1);
    expect(tracker.removed).toContainEqual(tracker.added[0]);
  });

  it('removes the abort listener after the race rejects with a non-abort error (no leak when work rejects first)', async () => {
    const controller = new AbortController();
    const tracker = trackAbortListeners(controller.signal);
    await expect(
      raceAgainstAbort(Promise.reject(new TypeError('boom')), controller.signal, 'encode'),
    ).rejects.toBeInstanceOf(TypeError);
    expect(tracker.added).toHaveLength(1);
    expect(tracker.removed).toContainEqual(tracker.added[0]);
  });

  it('does not install an abort listener when the signal is already aborted on entry', async () => {
    const controller = new AbortController();
    const reason = new Error('pre-aborted');
    controller.abort(reason);
    const tracker = trackAbortListeners(controller.signal);
    // Use a pending work promise so the abort path is the only way the
    // race settles; this proves the already-aborted branch rejects without
    // depending on `Promise.race` ordering against an already-settled work.
    const work = deferred<number>();
    await expect(raceAgainstAbort(work.promise, controller.signal, 'encode')).rejects.toMatchObject(
      { code: 'RUNTIME.ABORTED', cause: reason },
    );
    // Already-aborted path short-circuits without installing the listener.
    expect(tracker.added).toHaveLength(0);
    expect(tracker.removed).toHaveLength(0);
    work.resolve(1);
  });

  it('with undefined signal resolves with the work value and installs no listener', async () => {
    const result = await raceAgainstAbort(Promise.resolve(1), undefined, 'encode');
    expect(result).toBe(1);
  });

  it('with undefined signal propagates work rejections unchanged', async () => {
    const codecError = new TypeError('boom');
    await expect(raceAgainstAbort(Promise.reject(codecError), undefined, 'encode')).rejects.toBe(
      codecError,
    );
  });

  it('handles undefined signal.reason (default abort) by carrying undefined through to RUNTIME.ABORTED.cause', async () => {
    const controller = new AbortController();
    const work = deferred<string>();
    const racing = raceAgainstAbort(work.promise, controller.signal, 'stream');

    // Native AbortController.abort() with no argument synthesises a default
    // DOMException reason. We don't assert the exact reason value here, only
    // that it round-trips to `cause` verbatim.
    queueMicrotask(() => controller.abort());

    const error = await racing.catch((e: unknown) => e);
    expect((error as { code: string }).code).toBe('RUNTIME.ABORTED');
    expect((error as { details: { phase: string } }).details.phase).toBe('stream');
    expect((error as { cause?: unknown }).cause).toBe(controller.signal.reason);

    work.resolve('late');
  });
});

/**
 * Spy on `addEventListener('abort', …)` / `removeEventListener('abort', …)`
 * for a single signal. Returns the captured listener references so a test
 * can assert add/remove pairing precisely. AbortSignal does not expose
 * listener counts via any public API, so spying is the only way to prove
 * the helper installs and tears down its listener correctly.
 */
type AbortListenerArg = Parameters<AbortSignal['addEventListener']>[1];

function trackAbortListeners(signal: AbortSignal): {
  added: AbortListenerArg[];
  removed: AbortListenerArg[];
} {
  const added: AbortListenerArg[] = [];
  const removed: AbortListenerArg[] = [];
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((type, listener, options) => {
    if (type === 'abort' && listener) {
      added.push(listener);
    }
    return originalAdd(type, listener, options);
  }) as typeof signal.addEventListener;
  signal.removeEventListener = ((type, listener, options) => {
    if (type === 'abort' && listener) {
      removed.push(listener);
    }
    return originalRemove(type, listener, options);
  }) as typeof signal.removeEventListener;
  return { added, removed };
}
