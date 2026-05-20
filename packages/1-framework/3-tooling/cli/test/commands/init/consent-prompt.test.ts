import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as clack from '@clack/prompts';
import { readUserConfig, userConfigPath, writeUserConfig } from '@prisma-next/cli-telemetry';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INIT_EXIT_OK } from '../../../src/commands/init/exit-codes';
import { runInit } from '../../../src/commands/init/init';
import {
  type ResolvedInitInputs,
  resolveInitInputs,
  TELEMETRY_CONSENT_MESSAGE,
} from '../../../src/commands/init/inputs';
import type { GlobalFlags } from '../../../src/utils/global-flags';
import { isCI } from '../../../src/utils/is-ci';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
  select: vi.fn(async () => 'postgres'),
  text: vi.fn(async () => 'prisma/contract.prisma'),
  confirm: vi.fn(async () => true),
  note: vi.fn(),
  log: {
    message: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    step: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    clear: vi.fn(),
    isCancelled: false,
  })),
}));

vi.mock('../../../src/utils/is-ci', () => ({
  isCI: vi.fn(() => false),
}));

const initOptions = { target: 'postgres', authoring: 'psl', writeEnv: false };

function interactiveFlags(): GlobalFlags {
  return {
    json: false,
    quiet: false,
    verbose: 0,
    color: false,
    interactive: true,
    yes: false,
  };
}

function autoAcceptFlags(): GlobalFlags {
  return { ...interactiveFlags(), yes: true };
}

describe('telemetry consent prompt during `init`', () => {
  let projectDir: string;
  let xdgRoot: string;
  let originalXdg: string | undefined;
  let originalDisableTelemetry: string | undefined;
  let originalDoNotTrack: string | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'init-consent-project-'));
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'test' }));
    xdgRoot = mkdtempSync(join(tmpdir(), 'init-consent-xdg-'));
    originalXdg = process.env['XDG_CONFIG_HOME'];
    originalDisableTelemetry = process.env['PRISMA_NEXT_DISABLE_TELEMETRY'];
    originalDoNotTrack = process.env['DO_NOT_TRACK'];
    process.env['XDG_CONFIG_HOME'] = xdgRoot;
    delete process.env['PRISMA_NEXT_DISABLE_TELEMETRY'];
    delete process.env['DO_NOT_TRACK'];
    mkdirSync(dirname(userConfigPath()), { recursive: true });
    vi.clearAllMocks();
    vi.mocked(isCI).mockReturnValue(false);
    vi.mocked(clack.isCancel).mockReturnValue(false);
    vi.mocked(clack.select)
      .mockReset()
      .mockResolvedValueOnce('postgres')
      .mockResolvedValueOnce('psl');
    vi.mocked(clack.text).mockResolvedValue('prisma/contract.prisma');
  });

  afterEach(() => {
    restoreEnv('XDG_CONFIG_HOME', originalXdg);
    restoreEnv('PRISMA_NEXT_DISABLE_TELEMETRY', originalDisableTelemetry);
    restoreEnv('DO_NOT_TRACK', originalDoNotTrack);
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(xdgRoot, { recursive: true, force: true });
  });

  it('shows the prompt on a fresh machine, persists Yes + generates installationId', async () => {
    vi.mocked(clack.confirm).mockResolvedValue(true);

    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: initOptions,
      flags: interactiveFlags(),
      canPrompt: true,
    });

    expect(clack.confirm).toHaveBeenCalledOnce();
    expect(clack.confirm).toHaveBeenCalledWith({
      message: TELEMETRY_CONSENT_MESSAGE,
      initialValue: true,
      output: process.stderr,
    });
    expect(inputs.enableTelemetry).toBe(true);
    const stored = readUserConfig();
    expect(stored.enableTelemetry).toBe(true);
    expect(stored.installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('shows the prompt on a fresh machine, persists No + does NOT generate installationId', async () => {
    vi.mocked(clack.confirm).mockResolvedValue(false);

    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: initOptions,
      flags: interactiveFlags(),
      canPrompt: true,
    });

    expect(clack.confirm).toHaveBeenCalledOnce();
    expect(inputs.enableTelemetry).toBe(false);
    const stored = readUserConfig();
    expect(stored.enableTelemetry).toBe(false);
    expect(stored.installationId).toBeUndefined();
  });

  it('skips the prompt on a second run when enableTelemetry is already stored', async () => {
    writeUserConfig({ enableTelemetry: true });
    vi.mocked(clack.confirm).mockResolvedValue(false);

    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: initOptions,
      flags: interactiveFlags(),
      canPrompt: true,
    });

    expect(clack.confirm).not.toHaveBeenCalled();
    expect(inputs.enableTelemetry).toBeNull();
    expect(readUserConfig().enableTelemetry).toBe(true);
  });

  it('suppresses the prompt under --yes (autoAcceptPrompts) and leaves stored preference undefined', async () => {
    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: initOptions,
      flags: autoAcceptFlags(),
      canPrompt: true,
    });

    expect(clack.confirm).not.toHaveBeenCalled();
    expect(inputs.enableTelemetry).toBeNull();
    expect(readUserConfig().enableTelemetry).toBeUndefined();
  });

  it('suppresses the prompt when canPrompt is false (non-interactive stdin) and leaves stored preference undefined', async () => {
    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: initOptions,
      flags: interactiveFlags(),
      canPrompt: false,
    });

    expect(clack.confirm).not.toHaveBeenCalled();
    expect(inputs.enableTelemetry).toBeNull();
    expect(readUserConfig().enableTelemetry).toBeUndefined();
  });

  it('suppresses the prompt under PRISMA_NEXT_DISABLE_TELEMETRY and leaves stored preference undefined', async () => {
    process.env['PRISMA_NEXT_DISABLE_TELEMETRY'] = '1';

    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: initOptions,
      flags: interactiveFlags(),
      canPrompt: true,
    });

    expect(clack.confirm).not.toHaveBeenCalled();
    expect(inputs.enableTelemetry).toBeNull();
    expect(readUserConfig().enableTelemetry).toBeUndefined();
  });

  it('suppresses the prompt under DO_NOT_TRACK=1 and leaves stored preference undefined', async () => {
    process.env['DO_NOT_TRACK'] = '1';

    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: initOptions,
      flags: interactiveFlags(),
      canPrompt: true,
    });

    expect(clack.confirm).not.toHaveBeenCalled();
    expect(inputs.enableTelemetry).toBeNull();
    expect(readUserConfig().enableTelemetry).toBeUndefined();
  });

  it('suppresses the prompt in CI and leaves stored preference undefined', async () => {
    vi.mocked(isCI).mockReturnValue(true);

    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: initOptions,
      flags: interactiveFlags(),
      canPrompt: true,
    });

    expect(clack.confirm).not.toHaveBeenCalled();
    expect(inputs.enableTelemetry).toBeNull();
    expect(readUserConfig().enableTelemetry).toBeUndefined();
  });

  it('fires the init telemetry callback exactly once after affirmative first consent', async () => {
    vi.mocked(clack.confirm).mockResolvedValue(true);
    const afterFirstTelemetryConsent = vi.fn();

    const firstExit = await runInit(projectDir, {
      options: { ...initOptions, install: false },
      flags: interactiveFlags(),
      canPrompt: true,
      afterFirstTelemetryConsent,
    });

    expect(firstExit).toBe(INIT_EXIT_OK);
    expect(afterFirstTelemetryConsent).toHaveBeenCalledOnce();
    expect(afterFirstTelemetryConsent.mock.calls[0]?.[0].enableTelemetry).toBe(true);

    const secondExit = await runInit(projectDir, {
      options: { ...initOptions, force: true, install: false },
      flags: interactiveFlags(),
      canPrompt: true,
      afterFirstTelemetryConsent,
    });

    expect(secondExit).toBe(INIT_EXIT_OK);
    expect(afterFirstTelemetryConsent).toHaveBeenCalledOnce();
  });

  it('awaits an async afterFirstTelemetryConsent callback and swallows its rejections', async () => {
    vi.mocked(clack.confirm).mockResolvedValue(true);
    let resolveCallback: () => void = () => undefined;
    const callbackSettled = new Promise<void>((resolve) => {
      resolveCallback = resolve;
    });
    const afterFirstTelemetryConsent = vi.fn<(inputs: ResolvedInitInputs) => Promise<void>>(
      async () => {
        resolveCallback();
        throw new Error('telemetry post failed');
      },
    );

    const exitCode = await runInit(projectDir, {
      options: { ...initOptions, install: false },
      flags: interactiveFlags(),
      canPrompt: true,
      afterFirstTelemetryConsent,
    });

    await callbackSettled;

    // init succeeds even though the async callback rejected — the try/catch
    // around the awaited call must swallow it.
    expect(exitCode).toBe(INIT_EXIT_OK);
    expect(afterFirstTelemetryConsent).toHaveBeenCalledOnce();
  });

  it('preserves unknown fields on disk when persisting the consent answer', async () => {
    writeFileSync(
      userConfigPath(),
      JSON.stringify({ unknownField: 'preserve-me', nested: { foo: 1 } }),
    );
    vi.mocked(clack.confirm).mockResolvedValue(true);

    await resolveInitInputs({
      baseDir: projectDir,
      options: initOptions,
      flags: interactiveFlags(),
      canPrompt: true,
    });

    const stored = readUserConfig() as Record<string, unknown>;
    expect(stored['enableTelemetry']).toBe(true);
    expect(stored['unknownField']).toBe('preserve-me');
    expect(stored['nested']).toEqual({ foo: 1 });
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
