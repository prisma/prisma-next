import { describe, expect, it } from 'vitest';
import {
  buildTelemetryEvent,
  type EnrichEnvironment,
  parsePackageManager,
  readTsVersionFromPackageJson,
} from '../src/enrich';
import type { ParentToSenderPayload } from '../src/payload';

const basePayload: ParentToSenderPayload = {
  installationId: 'install-1',
  version: '0.9.0',
  command: 'migration new',
  flags: ['name', 'dry-run'],
  databaseTarget: 'postgres',
  extensions: ['pgvector'],
  projectRoot: '/project',
  endpoint: 'http://localhost/events',
};

const baseEnv: EnrichEnvironment = {
  platform: 'darwin',
  arch: 'arm64',
  versions: { node: '24.13.0' },
  env: {},
  readProjectPackageJson: () => null,
};

describe('parsePackageManager', () => {
  it('extracts the leading <pm>/<version> token from npm_config_user_agent', () => {
    expect(parsePackageManager('pnpm/10.27.0 npm/? node/v24.13.0 darwin arm64')).toBe(
      'pnpm/10.27.0',
    );
  });

  it('handles npm, yarn, and bun ua strings', () => {
    expect(parsePackageManager('npm/10.5.0 node/v24.13.0 darwin arm64')).toBe('npm/10.5.0');
    expect(parsePackageManager('yarn/4.6.0 npm/? node/v24.13.0 darwin arm64')).toBe('yarn/4.6.0');
    expect(parsePackageManager('bun/1.3.0 node/v24.13.0 darwin arm64')).toBe('bun/1.3.0');
  });

  it('returns null for undefined, empty, or malformed values', () => {
    expect(parsePackageManager(undefined)).toBeNull();
    expect(parsePackageManager('')).toBeNull();
    expect(parsePackageManager('nopepenope')).toBeNull();
  });
});

describe('readTsVersionFromPackageJson', () => {
  it('reads typescript from devDependencies and strips a leading ^', () => {
    expect(
      readTsVersionFromPackageJson(JSON.stringify({ devDependencies: { typescript: '^5.9.3' } })),
    ).toBe('5.9.3');
  });

  it('falls back to dependencies when devDependencies is absent', () => {
    expect(
      readTsVersionFromPackageJson(JSON.stringify({ dependencies: { typescript: '5.9.3' } })),
    ).toBe('5.9.3');
  });

  it('strips a leading ~ in addition to ^', () => {
    expect(
      readTsVersionFromPackageJson(JSON.stringify({ devDependencies: { typescript: '~5.9.0' } })),
    ).toBe('5.9.0');
  });

  it('prefers devDependencies over dependencies when both are present', () => {
    expect(
      readTsVersionFromPackageJson(
        JSON.stringify({
          devDependencies: { typescript: '5.9.0' },
          dependencies: { typescript: '5.0.0' },
        }),
      ),
    ).toBe('5.9.0');
  });

  it('returns null on null input (file missing)', () => {
    expect(readTsVersionFromPackageJson(null)).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(readTsVersionFromPackageJson('{not-json')).toBeNull();
  });

  it('returns null when typescript key is absent', () => {
    expect(
      readTsVersionFromPackageJson(JSON.stringify({ dependencies: { foo: '1.0' } })),
    ).toBeNull();
  });

  it('returns null when typescript is not a string', () => {
    expect(
      readTsVersionFromPackageJson(JSON.stringify({ devDependencies: { typescript: 5 } })),
    ).toBeNull();
  });
});

describe('buildTelemetryEvent', () => {
  it('round-trips the parent payload and overlays child-side probes', () => {
    const event = buildTelemetryEvent(basePayload, {
      ...baseEnv,
      env: { npm_config_user_agent: 'pnpm/10.27.0 node/v24.13.0' },
      readProjectPackageJson: () => JSON.stringify({ devDependencies: { typescript: '^5.9.3' } }),
    });

    expect(event).toEqual({
      installationId: 'install-1',
      version: '0.9.0',
      command: 'migration new',
      flags: ['name', 'dry-run'],
      runtimeName: 'node',
      runtimeVersion: '24.13.0',
      os: 'darwin',
      arch: 'arm64',
      packageManager: 'pnpm/10.27.0',
      databaseTarget: 'postgres',
      tsVersion: '5.9.3',
      agent: null,
      extensions: ['pgvector'],
    });
  });

  it('detects bun as the runtime when versions.bun is present', () => {
    const event = buildTelemetryEvent(basePayload, {
      ...baseEnv,
      versions: { node: '24.13.0', bun: '1.3.0' },
    });
    expect(event.runtimeName).toBe('bun');
    expect(event.runtimeVersion).toBe('1.3.0');
  });

  it('detects deno as the runtime when versions.deno is present', () => {
    const event = buildTelemetryEvent(basePayload, {
      ...baseEnv,
      versions: { node: '24.13.0', deno: '2.5.0' },
    });
    expect(event.runtimeName).toBe('deno');
    expect(event.runtimeVersion).toBe('2.5.0');
  });

  it('populates the agent field when a marker env var is set', () => {
    const event = buildTelemetryEvent(basePayload, { ...baseEnv, env: { CLAUDECODE: '1' } });
    expect(event.agent).toBe('Claude Code');
  });

  it('passes null tsVersion when the project package.json read fails', () => {
    const event = buildTelemetryEvent(basePayload, {
      ...baseEnv,
      readProjectPackageJson: () => null,
    });
    expect(event.tsVersion).toBeNull();
  });

  it('passes null packageManager when npm_config_user_agent is absent', () => {
    expect(buildTelemetryEvent(basePayload, baseEnv).packageManager).toBeNull();
  });
});
