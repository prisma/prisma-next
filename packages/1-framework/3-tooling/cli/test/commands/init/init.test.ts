import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  })),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('../../../src/control-api/operations/contract-emit', () => ({
  executeContractEmit: vi.fn(async () => ({
    storageHash: 'test-hash',
    profileHash: 'test-profile',
    files: { json: 'contract.json', dts: 'contract.d.ts' },
  })),
}));

import { execFileSync } from 'node:child_process';
import * as clack from '@clack/prompts';
import { runInit } from '../../../src/commands/init/init';

describe('runInit', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'init-test-'));
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app' }));
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
    vi.mocked(clack.select).mockResolvedValue('postgres');
    vi.mocked(clack.text).mockResolvedValue('prisma/contract.prisma');
    vi.mocked(clack.confirm).mockResolvedValue(true);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scaffolds five files for postgres target', async () => {
    await runInit(tmpDir, { noInstall: true });

    expect(existsSync(join(tmpDir, 'prisma/contract.prisma'))).toBe(true);
    expect(existsSync(join(tmpDir, 'prisma-next.config.ts'))).toBe(true);
    expect(existsSync(join(tmpDir, 'prisma/db.ts'))).toBe(true);
    expect(existsSync(join(tmpDir, 'prisma-next.md'))).toBe(true);
    expect(existsSync(join(tmpDir, '.agents/skills/prisma-next/SKILL.md'))).toBe(true);
  });

  it('generates config with single facade import and contract as string path', async () => {
    await runInit(tmpDir, { noInstall: true });

    const config = readFileSync(join(tmpDir, 'prisma-next.config.ts'), 'utf-8');
    expect(config).toContain("from '@prisma-next/postgres/config'");
    expect(config).toContain("contract: './prisma/contract.prisma'");
    const imports = config.split('\n').filter((l) => l.includes("from '@prisma-next/"));
    expect(imports).toHaveLength(1);
  });

  it('generates db.ts with single @prisma-next runtime import', async () => {
    await runInit(tmpDir, { noInstall: true });

    const db = readFileSync(join(tmpDir, 'prisma/db.ts'), 'utf-8');
    const prismaNextImports = db.split('\n').filter((l) => l.includes("from '@prisma-next/"));
    expect(prismaNextImports).toHaveLength(1);
    expect(prismaNextImports[0]).toContain('@prisma-next/postgres/runtime');
  });

  it('generates starter schema with User and Post models', async () => {
    await runInit(tmpDir, { noInstall: true });

    const schema = readFileSync(join(tmpDir, 'prisma/contract.prisma'), 'utf-8');
    expect(schema).toContain('model User');
    expect(schema).toContain('model Post');
  });

  it('prompts once to re-initialize when prisma-next.config.ts exists', async () => {
    writeFileSync(join(tmpDir, 'prisma-next.config.ts'), 'existing config');

    await runInit(tmpDir, { noInstall: true });

    expect(clack.confirm).toHaveBeenCalledTimes(1);
    expect(clack.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Re-initialize') }),
    );
  });

  it('overwrites all files when re-init is accepted', async () => {
    mkdirSync(join(tmpDir, 'prisma'), { recursive: true });
    writeFileSync(join(tmpDir, 'prisma-next.config.ts'), 'old config');
    writeFileSync(join(tmpDir, 'prisma/contract.prisma'), 'old schema');

    vi.mocked(clack.confirm).mockResolvedValue(true);

    await runInit(tmpDir, { noInstall: true });

    const config = readFileSync(join(tmpDir, 'prisma-next.config.ts'), 'utf-8');
    expect(config).not.toBe('old config');
    expect(config).toContain("from '@prisma-next/postgres/config'");

    const schema = readFileSync(join(tmpDir, 'prisma/contract.prisma'), 'utf-8');
    expect(schema).not.toBe('old schema');
    expect(schema).toContain('model User');
  });

  it('exits without changes when re-init is declined', async () => {
    writeFileSync(join(tmpDir, 'prisma-next.config.ts'), 'existing config');

    vi.mocked(clack.confirm).mockResolvedValue(false);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    await expect(runInit(tmpDir, { noInstall: true })).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(0);
    const config = readFileSync(join(tmpDir, 'prisma-next.config.ts'), 'utf-8');
    expect(config).toBe('existing config');

    exitSpy.mockRestore();
  });

  it('does not prompt when prisma-next.config.ts does not exist', async () => {
    await runInit(tmpDir, { noInstall: true });

    expect(clack.confirm).not.toHaveBeenCalled();
  });

  it('with --no-install skips dependency installation and emit', async () => {
    await runInit(tmpDir, { noInstall: true });

    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('detects pnpm and installs dependencies', async () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');

    await runInit(tmpDir, { noInstall: false });

    expect(execFileSync).toHaveBeenCalledWith(
      'pnpm',
      ['add', '@prisma-next/postgres'],
      expect.anything(),
    );
    expect(execFileSync).toHaveBeenCalledWith(
      'pnpm',
      ['add', '-D', '@prisma-next/cli'],
      expect.anything(),
    );
  });
});
