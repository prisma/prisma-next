import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  readUserConfig,
  sanitizeCommanderResult,
  userConfigPath,
  writeUserConfig,
} from '@prisma-next/cli-telemetry';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cliPackageJson from '../../package.json' with { type: 'json' };
import { loadConfig } from '../../src/config-loader';
import { isCI } from '../../src/utils/is-ci';
import {
  CLI_VERSION,
  commanderSnapshotForTelemetry,
  fireTelemetryFromPreAction,
} from '../../src/utils/telemetry';

vi.mock('../../src/config-loader', () => ({
  loadConfig: vi.fn(async () => ({
    target: { targetId: 'postgres' },
    extensionPacks: [{ id: 'pgvector' }],
  })),
}));

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
    vi.mocked(loadConfig).mockClear();
  });

  afterEach(() => {
    restoreEnv('XDG_CONFIG_HOME', originalXdg);
    restoreEnv('PRISMA_NEXT_DISABLE_TELEMETRY', originalDisableTelemetry);
    restoreEnv('DO_NOT_TRACK', originalDoNotTrack);
    rmSync(xdgRoot, { recursive: true, force: true });
  });

  it('uses the CLI package version from package.json', () => {
    expect(CLI_VERSION).toBe(cliPackageJson.version);
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

  it('does not load project config when env opt-out disables telemetry', async () => {
    writeUserConfig({ enableTelemetry: true });
    process.env['PRISMA_NEXT_DISABLE_TELEMETRY'] = '1';

    const outcome = await fireTelemetryFromPreAction(new Command('init'));

    expect(outcome).toEqual({ spawned: false, reason: 'gated-off' });
    expect(loadConfig).not.toHaveBeenCalled();
    expect(readUserConfig().enableTelemetry).toBe(true);
  });

  it('does not load project config when DO_NOT_TRACK disables telemetry', async () => {
    writeUserConfig({ enableTelemetry: true });
    process.env['DO_NOT_TRACK'] = '1';

    const outcome = await fireTelemetryFromPreAction(new Command('init'));

    expect(outcome).toEqual({ spawned: false, reason: 'gated-off' });
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it('does not load project config in CI', async () => {
    writeUserConfig({ enableTelemetry: true });
    vi.mocked(isCI).mockReturnValue(true);

    const outcome = await fireTelemetryFromPreAction(new Command('init'));

    expect(outcome).toEqual({ spawned: false, reason: 'ci' });
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it('does not load project config while telemetry is default-off', async () => {
    const outcome = await fireTelemetryFromPreAction(new Command('init'));

    expect(outcome).toEqual({ spawned: false, reason: 'gated-off' });
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it('loads project config after gates pass', async () => {
    writeUserConfig({ enableTelemetry: true });
    writeFileSync(userConfigPath(), JSON.stringify({ ...readUserConfig(), installationId: '' }));

    const outcome = await fireTelemetryFromPreAction(new Command('init'));

    expect(outcome).toEqual({ spawned: false, reason: 'gated-off' });
    expect(loadConfig).toHaveBeenCalledOnce();
  });
});
