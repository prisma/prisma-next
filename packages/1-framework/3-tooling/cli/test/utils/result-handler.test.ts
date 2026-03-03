import { notOk, ok } from '@prisma-next/utils/result';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CliStructuredError,
  errorConfigFileNotFound,
  errorMarkerMissing,
} from '../../src/utils/cli-errors';
import { handleResult } from '../../src/utils/result-handler';

describe('result handler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0 for successful result', () => {
    const result = ok('success');
    const exitCode = handleResult(result, {});
    expect(exitCode).toBe(0);
  });

  it('calls onSuccess callback for successful result', () => {
    const result = ok('success');
    const onSuccess = vi.fn();
    const exitCode = handleResult(result, {}, onSuccess);
    expect(exitCode).toBe(0);
    expect(onSuccess).toHaveBeenCalledWith('success');
  });

  it('returns exit code 2 for CLI errors', () => {
    const error = errorConfigFileNotFound();
    const result = notOk(error);
    const exitCode = handleResult(result, {});
    expect(exitCode).toBe(2);
  });

  it('returns exit code 1 for RTM errors', () => {
    const error = errorMarkerMissing();
    const result = notOk(error);
    const exitCode = handleResult(result, {});
    expect(exitCode).toBe(1);
  });

  it('outputs JSON error when json flag is object', () => {
    const error = errorConfigFileNotFound();
    const result = notOk(error);
    handleResult(result, { json: 'object' });
    expect(console.error).toHaveBeenCalled();
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(output).toBeDefined();
    expect(() => JSON.parse(output as string)).not.toThrow();
  });

  it('omits fix from JSON envelope when fix equals why', () => {
    const error = new CliStructuredError('4999', 'Unexpected error', {
      why: 'Same message',
      fix: 'Same message',
    });
    const result = notOk(error);

    handleResult(result, { json: 'object' });

    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const envelope = JSON.parse(output as string) as { why?: string; fix?: string };
    expect(envelope.why).toBe('Same message');
    expect(envelope.fix).toBeUndefined();
  });

  it('outputs human-readable error when json flag is not set', () => {
    const error = errorConfigFileNotFound();
    const result = notOk(error);
    handleResult(result, {});
    expect(console.error).toHaveBeenCalled();
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(output).toBeDefined();
    expect(typeof output).toBe('string');
  });

  it('outputs human-readable error when json flag is ndjson', () => {
    const error = errorConfigFileNotFound();
    const result = notOk(error);
    handleResult(result, { json: 'ndjson' });
    expect(console.error).toHaveBeenCalled();
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(output).toBeDefined();
    expect(typeof output).toBe('string');
  });
});
