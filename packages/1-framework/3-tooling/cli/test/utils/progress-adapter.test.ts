import { describe, expect, it, vi } from 'vitest';
import type { ControlProgressEvent } from '../../src/control-api/types.ts';
import { createProgressAdapter } from '../../src/utils/progress-adapter.ts';

describe('progress adapter', () => {
  it('is no-op when quiet flag is set', () => {
    const adapter = createProgressAdapter({ flags: { quiet: true } });
    const event: ControlProgressEvent = {
      action: 'dbInit',
      kind: 'spanStart',
      spanId: 'test',
      label: 'Test',
    };

    // Should not throw
    adapter(event);
  });

  it('is no-op when json output is enabled', () => {
    const adapter = createProgressAdapter({ flags: { json: 'object' } });
    const event: ControlProgressEvent = {
      action: 'dbInit',
      kind: 'spanStart',
      spanId: 'test',
      label: 'Test',
    };

    // Should not throw
    adapter(event);
  });

  it('handles spanStart and spanEnd events', () => {
    // Mock process.stdout.isTTY
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;

    try {
      const adapter = createProgressAdapter({ flags: {} });
      const events: ControlProgressEvent[] = [
        {
          action: 'dbInit',
          kind: 'spanStart',
          spanId: 'test',
          label: 'Test operation',
        },
        {
          action: 'dbInit',
          kind: 'spanEnd',
          spanId: 'test',
          outcome: 'ok',
        },
      ];

      // Should not throw
      for (const event of events) {
        adapter(event);
      }
    } finally {
      process.stdout.isTTY = originalIsTTY;
    }
  });

  it('handles spanEnd with error outcome', () => {
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;

    try {
      const adapter = createProgressAdapter({ flags: {} });

      // Start span
      adapter({
        action: 'dbInit',
        kind: 'spanStart',
        spanId: 'test-error',
        label: 'Test error operation',
      });

      // End span with error outcome
      adapter({
        action: 'dbInit',
        kind: 'spanEnd',
        spanId: 'test-error',
        outcome: 'error',
      });
    } finally {
      process.stdout.isTTY = originalIsTTY;
    }
  });

  it('handles spanEnd with skipped outcome', () => {
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;

    try {
      const adapter = createProgressAdapter({ flags: {} });

      // Start span
      adapter({
        action: 'dbInit',
        kind: 'spanStart',
        spanId: 'test-skipped',
        label: 'Test skipped operation',
      });

      // End span with skipped outcome
      adapter({
        action: 'dbInit',
        kind: 'spanEnd',
        spanId: 'test-skipped',
        outcome: 'skipped',
      });
    } finally {
      process.stdout.isTTY = originalIsTTY;
    }
  });

  it('handles spanEnd for unknown spanId gracefully', () => {
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;

    try {
      const adapter = createProgressAdapter({ flags: {} });

      // End span without starting it - should be no-op
      adapter({
        action: 'dbInit',
        kind: 'spanEnd',
        spanId: 'unknown-span',
        outcome: 'ok',
      });
    } finally {
      process.stdout.isTTY = originalIsTTY;
    }
  });

  it('handles color flag set to false', () => {
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;

    try {
      const adapter = createProgressAdapter({ flags: { color: false } });

      // Start span with color disabled
      adapter({
        action: 'dbInit',
        kind: 'spanStart',
        spanId: 'no-color-span',
        label: 'No color operation',
      });

      // End span
      adapter({
        action: 'dbInit',
        kind: 'spanEnd',
        spanId: 'no-color-span',
        outcome: 'ok',
      });
    } finally {
      process.stdout.isTTY = originalIsTTY;
    }
  });

  it('prints nested spans as lines instead of spinners', () => {
    // Mock process.stdout.isTTY
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;

    // Mock console.log
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const adapter = createProgressAdapter({ flags: {} });
      const event: ControlProgressEvent = {
        action: 'dbInit',
        kind: 'spanStart',
        spanId: 'operation:op-1',
        parentSpanId: 'apply',
        label: 'Create table users',
      };

      adapter(event);

      // Should log the operation as a line
      expect(consoleLogSpy).toHaveBeenCalledWith('  → Create table users...');
    } finally {
      consoleLogSpy.mockRestore();
      process.stdout.isTTY = originalIsTTY;
    }
  });
});
