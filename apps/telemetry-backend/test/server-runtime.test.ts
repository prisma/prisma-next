import { afterEach, describe, expect, it, vi } from 'vitest';
import { stopTelemetryBackend } from '../src/server-runtime';

describe('telemetry backend shutdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out the whole shutdown when server stop does not settle', async () => {
    vi.useFakeTimers();
    const close = vi.fn<() => Promise<void>>(async () => undefined);

    const resultPromise = stopTelemetryBackend(
      {
        port: 8080,
        stop: () => new Promise<void>(() => undefined),
      },
      { close },
    );

    await vi.advanceTimersByTimeAsync(10_000);

    await expect(resultPromise).resolves.toBe('timed-out');
    expect(close).not.toHaveBeenCalled();
  });

  it('times out the whole shutdown when app close does not settle', async () => {
    vi.useFakeTimers();
    const stop = vi.fn<() => Promise<void>>(async () => undefined);

    const resultPromise = stopTelemetryBackend(
      { port: 8080, stop },
      { close: () => new Promise<void>(() => undefined) },
    );

    await vi.advanceTimersByTimeAsync(10_000);

    await expect(resultPromise).resolves.toBe('timed-out');
    expect(stop).toHaveBeenCalledOnce();
  });
});
