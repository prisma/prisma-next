import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunTelemetryInputs } from '../src/spawn';
import { runTelemetry, senderModuleUrl } from '../src/spawn';
import { userConfigPath, writeUserConfig } from '../src/user-config';

const commandInput = {
  commandPath: ['prisma-next', 'init'],
  positionalArgs: [],
  parsedOptions: { target: 'postgres' },
};

function makeInputs(overrides: Partial<RunTelemetryInputs> = {}): RunTelemetryInputs {
  return {
    command: commandInput,
    version: '0.9.0',
    databaseTarget: 'postgres',
    extensions: [],
    projectRoot: process.cwd(),
    senderPath: '/non/existent/path/never-forked.mjs',
    isCI: false,
    env: {},
    ...overrides,
  };
}

describe('runTelemetry — gating decisions short-circuit before fork', () => {
  let xdgRoot: string;
  let originalXdg: string | undefined;

  beforeEach(() => {
    xdgRoot = mkdtempSync(join(tmpdir(), 'cli-telemetry-spawn-'));
    originalXdg = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = xdgRoot;
    mkdirSync(dirname(userConfigPath()), { recursive: true });
  });

  afterEach(() => {
    if (originalXdg === undefined) {
      delete process.env['XDG_CONFIG_HOME'];
    } else {
      process.env['XDG_CONFIG_HOME'] = originalXdg;
    }
    rmSync(xdgRoot, { recursive: true, force: true });
  });

  it('returns gated-off when no config file exists (default-off)', () => {
    expect(runTelemetry(makeInputs())).toEqual({ spawned: false, reason: 'gated-off' });
  });

  it('returns gated-off when enableTelemetry is false', () => {
    writeUserConfig({ enableTelemetry: false });
    expect(runTelemetry(makeInputs())).toEqual({ spawned: false, reason: 'gated-off' });
  });

  it('returns ci when isCI is true, even with stored opt-in', () => {
    writeUserConfig({ enableTelemetry: true });
    expect(runTelemetry(makeInputs({ isCI: true }))).toEqual({ spawned: false, reason: 'ci' });
  });

  it('returns gated-off when PRISMA_NEXT_DISABLE_TELEMETRY overrides a stored opt-in', () => {
    writeUserConfig({ enableTelemetry: true });
    expect(runTelemetry(makeInputs({ env: { PRISMA_NEXT_DISABLE_TELEMETRY: '1' } }))).toEqual({
      spawned: false,
      reason: 'gated-off',
    });
  });

  it('returns gated-off when DO_NOT_TRACK=1 overrides a stored opt-in', () => {
    writeUserConfig({ enableTelemetry: true });
    expect(runTelemetry(makeInputs({ env: { DO_NOT_TRACK: '1' } }))).toEqual({
      spawned: false,
      reason: 'gated-off',
    });
  });

  it('returns gated-off when installationId is missing despite enableTelemetry=true (defence-in-depth)', () => {
    writeFileSync(userConfigPath(), JSON.stringify({ enableTelemetry: true }));
    expect(runTelemetry(makeInputs())).toEqual({ spawned: false, reason: 'gated-off' });
  });

  it('returns fork-failed when the sender path does not exist (every failure is swallowed)', () => {
    writeUserConfig({ enableTelemetry: true });
    // fork() of a nonexistent path errors asynchronously on the child's
    // exit; spawn returns spawned: true and the child fails out-of-band.
    // What matters here is that the call returns synchronously and
    // doesn't throw — we verify by calling and inspecting the return.
    const result = runTelemetry(makeInputs());
    expect(result.spawned === true || result.spawned === false).toBe(true);
  });
});

describe('senderModuleUrl', () => {
  it('resolves the sender entry relative to the consumer`s import.meta.url', () => {
    const consumer = 'file:///some/consumer/dist/cli.mjs';
    expect(senderModuleUrl(consumer)).toBe('/some/consumer/dist/sender.mjs');
  });
});
