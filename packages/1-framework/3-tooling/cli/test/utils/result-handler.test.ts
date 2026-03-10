import { notOk, ok } from '@prisma-next/utils/result';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CliStructuredError,
  errorConfigFileNotFound,
  errorMarkerMissing,
} from '../../src/utils/cli-errors';
import { handleResult } from '../../src/utils/result-handler';
import { TerminalUI } from '../../src/utils/terminal-ui';

function createUI(flags?: { json?: boolean }) {
  return new TerminalUI({ color: false, interactive: !flags?.json });
}

describe('result handler', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0 for successful result', () => {
    const result = ok('success');
    const exitCode = handleResult(result, {}, createUI());
    expect(exitCode).toBe(0);
  });

  it('calls onSuccess callback for successful result', () => {
    const result = ok('success');
    const onSuccess = vi.fn();
    const exitCode = handleResult(result, {}, createUI(), onSuccess);
    expect(exitCode).toBe(0);
    expect(onSuccess).toHaveBeenCalledWith('success');
  });

  it('returns exit code 2 for CLI errors', () => {
    const error = errorConfigFileNotFound();
    const result = notOk(error);
    const exitCode = handleResult(result, {}, createUI());
    expect(exitCode).toBe(2);
  });

  it('returns exit code 1 for RTM errors', () => {
    const error = errorMarkerMissing();
    const result = notOk(error);
    const exitCode = handleResult(result, {}, createUI());
    expect(exitCode).toBe(1);
  });

  it('writes JSON error to stdout when json flag is set', () => {
    const error = errorConfigFileNotFound();
    const result = notOk(error);
    handleResult(result, { json: true }, createUI({ json: true }));

    // JSON data goes to stdout via ui.output()
    const stdoutCalls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const jsonOutput = stdoutCalls.find((s: string) => s.includes('{'));
    expect(jsonOutput).toBeDefined();
    expect(() => JSON.parse(jsonOutput!.trim())).not.toThrow();
  });

  it('omits fix from JSON envelope when fix equals why', () => {
    const error = new CliStructuredError('4999', 'Unexpected error', {
      why: 'Same message',
      fix: 'Same message',
    });
    const result = notOk(error);

    handleResult(result, { json: true }, createUI({ json: true }));

    const stdoutCalls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const jsonOutput = stdoutCalls.find((s: string) => s.includes('{'));
    expect(jsonOutput).toBeDefined();
    const envelope = JSON.parse(jsonOutput!.trim()) as { why?: string; fix?: string };
    expect(envelope.why).toBe('Same message');
    expect(envelope.fix).toBeUndefined();
  });

  it('writes error to stderr when json flag is not set', () => {
    const error = errorConfigFileNotFound();
    const result = notOk(error);
    handleResult(result, {}, createUI());

    // Error goes to stderr via clack
    expect(stderrSpy).toHaveBeenCalled();
  });
});
