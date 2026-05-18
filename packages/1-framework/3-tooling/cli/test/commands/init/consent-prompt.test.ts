import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as clack from '@clack/prompts';
import { readUserConfig, userConfigPath, writeUserConfig } from '@prisma-next/cli-telemetry';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveInitInputs } from '../../../src/commands/init/inputs';
import type { GlobalFlags } from '../../../src/utils/global-flags';

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

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'init-consent-project-'));
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'test' }));
    xdgRoot = mkdtempSync(join(tmpdir(), 'init-consent-xdg-'));
    originalXdg = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = xdgRoot;
    mkdirSync(dirname(userConfigPath()), { recursive: true });
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
    vi.mocked(clack.select)
      .mockReset()
      .mockResolvedValueOnce('postgres')
      .mockResolvedValueOnce('psl');
    vi.mocked(clack.text).mockResolvedValue('prisma/contract.prisma');
  });

  afterEach(() => {
    if (originalXdg === undefined) {
      delete process.env['XDG_CONFIG_HOME'];
    } else {
      process.env['XDG_CONFIG_HOME'] = originalXdg;
    }
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(xdgRoot, { recursive: true, force: true });
  });

  it('shows the prompt on a fresh machine, persists Yes + generates installationId', async () => {
    vi.mocked(clack.confirm).mockResolvedValue(true);

    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: { target: 'postgres', authoring: 'psl' },
      flags: interactiveFlags(),
      canPrompt: true,
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
      options: { target: 'postgres', authoring: 'psl' },
      flags: interactiveFlags(),
      canPrompt: true,
    });

    expect(inputs.enableTelemetry).toBe(false);
    const stored = readUserConfig();
    expect(stored.enableTelemetry).toBe(false);
    expect(stored.installationId).toBeUndefined();
  });

  it('skips the prompt on a second run when enableTelemetry is already stored', async () => {
    writeUserConfig({ enableTelemetry: true });
    vi.mocked(clack.confirm).mockResolvedValue(false); // would persist false if asked

    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: { target: 'postgres', authoring: 'psl' },
      flags: interactiveFlags(),
      canPrompt: true,
    });

    expect(inputs.enableTelemetry).toBeNull();
    expect(readUserConfig().enableTelemetry).toBe(true);
  });

  it('suppresses the prompt under --yes (autoAcceptPrompts) and leaves stored preference undefined', async () => {
    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: { target: 'postgres', authoring: 'psl' },
      flags: autoAcceptFlags(),
      canPrompt: true,
    });

    expect(inputs.enableTelemetry).toBeNull();
    expect(readUserConfig().enableTelemetry).toBeUndefined();
  });

  it('suppresses the prompt when canPrompt is false (non-interactive stdin) and leaves stored preference undefined', async () => {
    const inputs = await resolveInitInputs({
      baseDir: projectDir,
      options: { target: 'postgres', authoring: 'psl' },
      flags: interactiveFlags(),
      canPrompt: false,
    });

    expect(inputs.enableTelemetry).toBeNull();
    expect(readUserConfig().enableTelemetry).toBeUndefined();
  });

  it('preserves unknown fields on disk when persisting the consent answer', async () => {
    writeFileSync(
      userConfigPath(),
      JSON.stringify({ unknownField: 'preserve-me', nested: { foo: 1 } }),
    );
    vi.mocked(clack.confirm).mockResolvedValue(true);

    await resolveInitInputs({
      baseDir: projectDir,
      options: { target: 'postgres', authoring: 'psl' },
      flags: interactiveFlags(),
      canPrompt: true,
    });

    const stored = readUserConfig() as Record<string, unknown>;
    expect(stored['enableTelemetry']).toBe(true);
    expect(stored['unknownField']).toBe('preserve-me');
    expect(stored['nested']).toEqual({ foo: 1 });
  });
});
