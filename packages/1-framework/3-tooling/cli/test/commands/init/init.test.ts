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

  it('scaffolds three files for postgres target', async () => {
    await runInit(tmpDir, { noInstall: true });

    expect(existsSync(join(tmpDir, 'prisma/contract.prisma'))).toBe(true);
    expect(existsSync(join(tmpDir, 'prisma-next.config.ts'))).toBe(true);
    expect(existsSync(join(tmpDir, 'prisma/db.ts'))).toBe(true);
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

  it('prompts for overwrite when files exist', async () => {
    mkdirSync(join(tmpDir, 'prisma'), { recursive: true });
    writeFileSync(join(tmpDir, 'prisma/contract.prisma'), 'existing');

    await runInit(tmpDir, { noInstall: true });

    expect(clack.confirm).toHaveBeenCalled();
  });

  it('skips file when overwrite is declined', async () => {
    mkdirSync(join(tmpDir, 'prisma'), { recursive: true });
    writeFileSync(join(tmpDir, 'prisma/contract.prisma'), 'existing content');

    vi.mocked(clack.confirm).mockResolvedValue(false);

    await runInit(tmpDir, { noInstall: true });

    const content = readFileSync(join(tmpDir, 'prisma/contract.prisma'), 'utf-8');
    expect(content).toBe('existing content');
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
