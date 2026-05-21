import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  readUserConfig,
  sanitizeCommanderResult,
  userConfigPath,
  writeUserConfig,
} from '@prisma-next/cli-telemetry';
import { Command } from 'commander';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCI } from '../../src/utils/is-ci';
import {
  commanderSnapshotForTelemetry,
  fireTelemetryFromPreAction,
} from '../../src/utils/telemetry';

vi.mock('../../src/utils/is-ci', () => ({
  isCI: vi.fn(() => false),
}));

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('CLI telemetry bridge', () => {
  let xdgRoot: string;
  let originalXdg: string | undefined;
  let originalDisableTelemetry: string | undefined;
  let originalDoNotTrack: string | undefined;

  beforeEach(() => {
    xdgRoot = mkdtempSync(join(tmpdir(), 'cli-telemetry-bridge-'));
    originalXdg = process.env['XDG_CONFIG_HOME'];
    originalDisableTelemetry = process.env['PRISMA_NEXT_DISABLE_TELEMETRY'];
    originalDoNotTrack = process.env['DO_NOT_TRACK'];
    process.env['XDG_CONFIG_HOME'] = xdgRoot;
    delete process.env['PRISMA_NEXT_DISABLE_TELEMETRY'];
    delete process.env['DO_NOT_TRACK'];
    mkdirSync(dirname(userConfigPath()), { recursive: true });
    vi.mocked(isCI).mockReturnValue(false);
  });

  afterEach(() => {
    restoreEnv('XDG_CONFIG_HOME', originalXdg);
    restoreEnv('PRISMA_NEXT_DISABLE_TELEMETRY', originalDisableTelemetry);
    restoreEnv('DO_NOT_TRACK', originalDoNotTrack);
    rmSync(xdgRoot, { recursive: true, force: true });
  });

  it('projects only user-supplied long flag names from Commander metadata', () => {
    const command = new Command('init')
      .option('--schema-path <path>')
      .option('--no-install')
      .option('--connection-string <url>')
      .option('--dry-run')
      .option('-y, --yes');
    command.parse([
      'node',
      'init',
      '--schema-path',
      '/Users/alice/secrets/schema.prisma',
      '--no-install',
      '--connection-string',
      'postgres://user:pass@host/db',
      '--dry-run',
    ]);

    const snapshot = commanderSnapshotForTelemetry(command);

    expect(snapshot.options).toEqual([
      { attributeName: 'schemaPath', longName: '--schema-path', source: 'cli' },
      { attributeName: 'install', longName: '--no-install', source: 'cli' },
      { attributeName: 'connectionString', longName: '--connection-string', source: 'cli' },
      { attributeName: 'dryRun', longName: '--dry-run', source: 'cli' },
      { attributeName: 'yes', longName: '--yes', source: null },
    ]);
    expect(sanitizeCommanderResult(snapshot).flags).toEqual([
      'schema-path',
      'no-install',
      'connection-string',
      'dry-run',
    ]);
  });

  it('returns gated-off without forking when env opt-out disables telemetry', () => {
    writeUserConfig({ enableTelemetry: true });
    process.env['PRISMA_NEXT_DISABLE_TELEMETRY'] = '1';

    const outcome = fireTelemetryFromPreAction(new Command('init'));

    expect(outcome).toEqual({ spawned: false, reason: 'gated-off' });
    expect(readUserConfig().enableTelemetry).toBe(true);
  });

  it('returns gated-off without forking when DO_NOT_TRACK disables telemetry', () => {
    writeUserConfig({ enableTelemetry: true });
    process.env['DO_NOT_TRACK'] = '1';

    const outcome = fireTelemetryFromPreAction(new Command('init'));

    expect(outcome).toEqual({ spawned: false, reason: 'gated-off' });
  });

  it('returns ci without forking when isCI is true', () => {
    writeUserConfig({ enableTelemetry: true });
    vi.mocked(isCI).mockReturnValue(true);

    const outcome = fireTelemetryFromPreAction(new Command('init'));

    expect(outcome).toEqual({ spawned: false, reason: 'ci' });
  });

  it('returns gated-off without forking while telemetry is default-off', () => {
    const outcome = fireTelemetryFromPreAction(new Command('init'));

    expect(outcome).toEqual({ spawned: false, reason: 'gated-off' });
  });
});
