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
    clear: vi.fn(),
    isCancelled: false,
  })),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: (err: null) => void) =>
      cb(null),
  ),
}));

vi.mock('../../../src/control-api/operations/contract-emit', () => ({
  executeContractEmit: vi.fn(async () => ({
    storageHash: 'test-hash',
    profileHash: 'test-profile',
    files: { json: 'contract.json', dts: 'contract.d.ts' },
  })),
}));

import { execFile } from 'node:child_process';
import * as clack from '@clack/prompts';
import {
  INIT_EXIT_OK,
  INIT_EXIT_PRECONDITION,
  INIT_EXIT_USER_ABORTED,
} from '../../../src/commands/init/exit-codes';
import { runInit } from '../../../src/commands/init/init';
import type { GlobalFlags } from '../../../src/utils/global-flags';

/**
 * GlobalFlags shape for an interactive run with stdout to a TTY. Tests
 * that drive `runInit` directly construct one of these rather than going
 * through `parseGlobalFlags`, which inspects `process.stdout.isTTY` and
 * is not deterministic across CI / local runs.
 */
const interactiveFlags = (overrides: Partial<GlobalFlags> = {}): GlobalFlags => ({
  json: false,
  quiet: false,
  verbose: 0,
  color: false,
  interactive: true,
  yes: false,
  ...overrides,
});

const noninteractiveFlags = (overrides: Partial<GlobalFlags> = {}): GlobalFlags => ({
  json: false,
  quiet: true,
  verbose: 0,
  color: false,
  interactive: false,
  yes: true,
  ...overrides,
});

describe('runInit (interactive)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'init-test-'));
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app' }));
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
    vi.mocked(clack.select)
      .mockReset()
      .mockResolvedValueOnce('postgres')
      .mockResolvedValueOnce('psl');
    vi.mocked(clack.text).mockResolvedValue('prisma/contract.prisma');
    vi.mocked(clack.confirm).mockResolvedValue(true);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scaffolds five files for postgres target', async () => {
    const exit = await runInit(tmpDir, {
      options: { install: false },
      flags: interactiveFlags(),
    });
    expect(exit).toBe(INIT_EXIT_OK);
    expect(existsSync(join(tmpDir, 'prisma/contract.prisma'))).toBe(true);
    expect(existsSync(join(tmpDir, 'prisma-next.config.ts'))).toBe(true);
    expect(existsSync(join(tmpDir, 'prisma/db.ts'))).toBe(true);
    expect(existsSync(join(tmpDir, 'prisma-next.md'))).toBe(true);
    expect(existsSync(join(tmpDir, '.agents/skills/prisma-next/SKILL.md'))).toBe(true);
  });

  it('generates config with single facade import and contract as string path', async () => {
    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

    const config = readFileSync(join(tmpDir, 'prisma-next.config.ts'), 'utf-8');
    expect(config).toContain("from '@prisma-next/postgres/config'");
    expect(config).toContain('contract: "./prisma/contract.prisma"');
    const imports = config.split('\n').filter((l) => l.includes("from '@prisma-next/"));
    expect(imports).toHaveLength(1);
  });

  it('generates db.ts with single @prisma-next runtime import', async () => {
    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

    const db = readFileSync(join(tmpDir, 'prisma/db.ts'), 'utf-8');
    const prismaNextImports = db.split('\n').filter((l) => l.includes("from '@prisma-next/"));
    expect(prismaNextImports).toHaveLength(1);
    expect(prismaNextImports[0]).toContain('@prisma-next/postgres/runtime');
  });

  it('generates PSL starter schema with User and Post models', async () => {
    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

    const schema = readFileSync(join(tmpDir, 'prisma/contract.prisma'), 'utf-8');
    expect(schema).toContain('model User');
    expect(schema).toContain('model Post');
  });

  it('scaffolds TypeScript contract when typescript authoring is selected', async () => {
    vi.mocked(clack.select)
      .mockReset()
      .mockResolvedValueOnce('postgres')
      .mockResolvedValueOnce('typescript');
    vi.mocked(clack.text).mockResolvedValue('prisma/contract.ts');

    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

    const schema = readFileSync(join(tmpDir, 'prisma/contract.ts'), 'utf-8');
    expect(schema).toContain('defineContract');
    expect(schema).toContain("from '@prisma-next/sql-contract-ts/contract-builder'");

    const config = readFileSync(join(tmpDir, 'prisma-next.config.ts'), 'utf-8');
    expect(config).toContain('contract: "./prisma/contract.ts"');
  });

  it('prompts once to re-initialize when prisma-next.config.ts exists', async () => {
    writeFileSync(join(tmpDir, 'prisma-next.config.ts'), 'existing config');

    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

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

    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

    const config = readFileSync(join(tmpDir, 'prisma-next.config.ts'), 'utf-8');
    expect(config).not.toBe('old config');
    expect(config).toContain("from '@prisma-next/postgres/config'");

    const schema = readFileSync(join(tmpDir, 'prisma/contract.prisma'), 'utf-8');
    expect(schema).not.toBe('old schema');
    expect(schema).toContain('model User');
  });

  it('exits with USER_ABORTED and no changes when re-init is declined', async () => {
    writeFileSync(join(tmpDir, 'prisma-next.config.ts'), 'existing config');
    vi.mocked(clack.confirm).mockResolvedValue(false);

    const exit = await runInit(tmpDir, {
      options: { install: false },
      flags: interactiveFlags(),
    });

    expect(exit).toBe(INIT_EXIT_USER_ABORTED);
    const config = readFileSync(join(tmpDir, 'prisma-next.config.ts'), 'utf-8');
    expect(config).toBe('existing config');
  });

  it('does not prompt when prisma-next.config.ts does not exist', async () => {
    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

    expect(clack.confirm).not.toHaveBeenCalled();
  });

  it('normalizes configPath when schema path starts with ./', async () => {
    vi.mocked(clack.text).mockResolvedValue('./prisma/contract.prisma');

    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

    const config = readFileSync(join(tmpDir, 'prisma-next.config.ts'), 'utf-8');
    expect(config).toContain('contract: "./prisma/contract.prisma"');
    expect(config).not.toContain('.//');
  });

  it('with --no-install skips dependency installation and emit', async () => {
    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

    expect(execFile).not.toHaveBeenCalled();
    expect(existsSync(join(tmpDir, 'prisma/contract.json'))).toBe(false);
    expect(existsSync(join(tmpDir, 'prisma/contract.d.ts'))).toBe(false);
  });

  it('detects pnpm and installs dependencies', async () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');

    await runInit(tmpDir, { options: { install: true }, flags: interactiveFlags() });

    expect(execFile).toHaveBeenCalledWith(
      'pnpm',
      ['add', '@prisma-next/postgres', 'dotenv'],
      expect.anything(),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenCalledWith(
      'pnpm',
      ['add', '-D', 'prisma-next'],
      expect.anything(),
      expect.any(Function),
    );
  });

  it('detects deno and installs with npm: prefix', async () => {
    rmSync(join(tmpDir, 'package.json'));
    writeFileSync(join(tmpDir, 'deno.json'), '{}');
    writeFileSync(join(tmpDir, 'deno.lock'), '{}');

    await runInit(tmpDir, { options: { install: true }, flags: interactiveFlags() });

    expect(execFile).toHaveBeenCalledWith(
      'deno',
      ['add', 'npm:@prisma-next/postgres', 'npm:dotenv'],
      expect.anything(),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenCalledWith(
      'deno',
      ['add', '--dev', 'npm:prisma-next'],
      expect.anything(),
      expect.any(Function),
    );
  });

  it('shows prisma-next.md in outro', async () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');

    await runInit(tmpDir, { options: { install: true }, flags: interactiveFlags() });

    const outroCall = vi.mocked(clack.outro).mock.calls[0]?.[0] as string | undefined;
    expect(outroCall).toContain('prisma-next.md');
  });

  it('exits with PRECONDITION when no package.json exists', async () => {
    rmSync(join(tmpDir, 'package.json'));

    const exit = await runInit(tmpDir, {
      options: { install: false },
      flags: interactiveFlags(),
    });

    expect(exit).toBe(INIT_EXIT_PRECONDITION);
    expect(clack.select).not.toHaveBeenCalled();
  });

  it('does not write any files when no package.json exists', async () => {
    rmSync(join(tmpDir, 'package.json'));

    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

    expect(existsSync(join(tmpDir, 'prisma-next.config.ts'))).toBe(false);
    expect(existsSync(join(tmpDir, 'prisma'))).toBe(false);
  });

  it('accepts deno.json as project manifest', async () => {
    rmSync(join(tmpDir, 'package.json'));
    writeFileSync(join(tmpDir, 'deno.json'), '{}');
    writeFileSync(join(tmpDir, 'deno.lock'), '{}');

    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

    expect(existsSync(join(tmpDir, 'prisma-next.config.ts'))).toBe(true);
  });

  it('accepts deno.jsonc as project manifest', async () => {
    rmSync(join(tmpDir, 'package.json'));
    writeFileSync(join(tmpDir, 'deno.jsonc'), '{}');

    await runInit(tmpDir, { options: { install: false }, flags: interactiveFlags() });

    expect(existsSync(join(tmpDir, 'prisma-next.config.ts'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FR1 — Non-interactive scriptable mode (TML-2263 headline finding)
// ---------------------------------------------------------------------------

describe('runInit (non-interactive, FR1)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'init-noninteractive-test-'));
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app' }));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs without prompts when --target and --authoring are supplied (FR1.3)', async () => {
    const exit = await runInit(tmpDir, {
      options: {
        target: 'postgres',
        authoring: 'psl',
        install: false,
      },
      flags: noninteractiveFlags(),
    });

    expect(exit).toBe(INIT_EXIT_OK);
    expect(clack.select).not.toHaveBeenCalled();
    expect(clack.text).not.toHaveBeenCalled();
    expect(clack.confirm).not.toHaveBeenCalled();
    expect(existsSync(join(tmpDir, 'prisma/contract.prisma'))).toBe(true);
    expect(existsSync(join(tmpDir, 'prisma-next.config.ts'))).toBe(true);
  });

  it('accepts --target mongodb (the user-facing alias for the internal mongo target)', async () => {
    await runInit(tmpDir, {
      options: { target: 'mongodb', authoring: 'psl', install: false },
      flags: noninteractiveFlags(),
    });

    const config = readFileSync(join(tmpDir, 'prisma-next.config.ts'), 'utf-8');
    expect(config).toContain("from '@prisma-next/mongo/config'");
  });

  it('accepts --authoring typescript (FR1.1)', async () => {
    await runInit(tmpDir, {
      options: { target: 'postgres', authoring: 'typescript', install: false },
      flags: noninteractiveFlags(),
    });

    expect(existsSync(join(tmpDir, 'prisma/contract.ts'))).toBe(true);
  });

  it('honours --schema-path (FR1.1)', async () => {
    await runInit(tmpDir, {
      options: {
        target: 'postgres',
        authoring: 'psl',
        schemaPath: 'db/schema.prisma',
        install: false,
      },
      flags: noninteractiveFlags(),
    });

    expect(existsSync(join(tmpDir, 'db/schema.prisma'))).toBe(true);
    expect(existsSync(join(tmpDir, 'db/db.ts'))).toBe(true);
  });

  it('exits PRECONDITION when --target is missing in non-interactive mode (FR1.4)', async () => {
    const exit = await runInit(tmpDir, {
      options: { authoring: 'psl', install: false },
      flags: noninteractiveFlags(),
    });

    expect(exit).toBe(INIT_EXIT_PRECONDITION);
    expect(existsSync(join(tmpDir, 'prisma-next.config.ts'))).toBe(false);
    expect(existsSync(join(tmpDir, 'prisma'))).toBe(false);
  });

  it('exits PRECONDITION when --authoring is missing in non-interactive mode (FR1.4)', async () => {
    const exit = await runInit(tmpDir, {
      options: { target: 'postgres', install: false },
      flags: noninteractiveFlags(),
    });

    expect(exit).toBe(INIT_EXIT_PRECONDITION);
    expect(existsSync(join(tmpDir, 'prisma-next.config.ts'))).toBe(false);
  });

  it('exits PRECONDITION when no flags are supplied in non-interactive mode (FR1.4)', async () => {
    const exit = await runInit(tmpDir, {
      options: { install: false },
      flags: noninteractiveFlags(),
    });

    expect(exit).toBe(INIT_EXIT_PRECONDITION);
  });

  it('exits PRECONDITION on invalid --target value', async () => {
    const exit = await runInit(tmpDir, {
      options: { target: 'sqlite', authoring: 'psl', install: false },
      flags: noninteractiveFlags(),
    });

    expect(exit).toBe(INIT_EXIT_PRECONDITION);
  });

  it('exits PRECONDITION on invalid --authoring value', async () => {
    const exit = await runInit(tmpDir, {
      options: { target: 'postgres', authoring: 'graphql', install: false },
      flags: noninteractiveFlags(),
    });

    expect(exit).toBe(INIT_EXIT_PRECONDITION);
  });

  it('refuses --strict-probe without --probe-db (FR8.3 / NFR9 offline-by-default)', async () => {
    const exit = await runInit(tmpDir, {
      options: {
        target: 'postgres',
        authoring: 'psl',
        strictProbe: true,
        install: false,
      },
      flags: noninteractiveFlags(),
    });

    expect(exit).toBe(INIT_EXIT_PRECONDITION);
    // Should fail before any file is written — offline guarantee starts at input validation.
    expect(existsSync(join(tmpDir, 'prisma-next.config.ts'))).toBe(false);
  });

  it('exits PRECONDITION when re-init is needed but --force is not supplied', async () => {
    writeFileSync(join(tmpDir, 'prisma-next.config.ts'), 'existing');

    const exit = await runInit(tmpDir, {
      options: { target: 'postgres', authoring: 'psl', install: false },
      flags: noninteractiveFlags(),
    });

    expect(exit).toBe(INIT_EXIT_PRECONDITION);
    expect(readFileSync(join(tmpDir, 'prisma-next.config.ts'), 'utf-8')).toBe('existing');
  });

  it('overwrites with --force in non-interactive mode', async () => {
    writeFileSync(join(tmpDir, 'prisma-next.config.ts'), 'existing');

    const exit = await runInit(tmpDir, {
      options: { target: 'postgres', authoring: 'psl', force: true, install: false },
      flags: noninteractiveFlags(),
    });

    expect(exit).toBe(INIT_EXIT_OK);
    const config = readFileSync(join(tmpDir, 'prisma-next.config.ts'), 'utf-8');
    expect(config).not.toBe('existing');
    expect(config).toContain("from '@prisma-next/postgres/config'");
  });
});

// ---------------------------------------------------------------------------
// FR1.5 / FR10 — Structured JSON output
// ---------------------------------------------------------------------------

describe('runInit (--json output, FR1.5 / FR10.2)', () => {
  let tmpDir: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let captured: string[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'init-json-test-'));
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app' }));
    vi.clearAllMocks();
    captured = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') {
        captured.push(chunk);
      } else if (chunk instanceof Uint8Array) {
        captured.push(Buffer.from(chunk).toString('utf-8'));
      }
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a single JSON document to stdout with all required fields', async () => {
    const exit = await runInit(tmpDir, {
      options: { target: 'postgres', authoring: 'psl', install: false },
      flags: noninteractiveFlags({ json: true }),
    });

    expect(exit).toBe(INIT_EXIT_OK);

    const stdoutText = captured.join('').trim();
    const parsed = JSON.parse(stdoutText) as Record<string, unknown>;
    expect(parsed['ok']).toBe(true);
    expect(parsed['target']).toBe('postgres');
    expect(parsed['authoring']).toBe('psl');
    expect(parsed['schemaPath']).toBe('prisma/contract.prisma');
    expect(Array.isArray(parsed['filesWritten'])).toBe(true);
    expect((parsed['filesWritten'] as string[]).length).toBeGreaterThan(0);
    expect(parsed['packagesInstalled']).toMatchObject({ skipped: true });
    expect(Array.isArray(parsed['nextSteps'])).toBe(true);
    expect((parsed['nextSteps'] as string[]).length).toBeGreaterThan(0);
  });

  it('writes a structured error to stdout in JSON mode when preconditions fail', async () => {
    const exit = await runInit(tmpDir, {
      options: { install: false },
      flags: noninteractiveFlags({ json: true }),
    });

    expect(exit).toBe(INIT_EXIT_PRECONDITION);

    const stdoutText = captured.join('').trim();
    const parsed = JSON.parse(stdoutText) as Record<string, unknown>;
    expect(parsed['ok']).toBe(false);
    expect(parsed['code']).toBe('PN-CLI-5003');
    expect((parsed['meta'] as Record<string, unknown>)['missingFlags'] as string[]).toContain(
      'target',
    );
  });

  it('reports the mongodb alias (not the internal "mongo") in --json output', async () => {
    await runInit(tmpDir, {
      options: { target: 'mongodb', authoring: 'psl', install: false },
      flags: noninteractiveFlags({ json: true }),
    });

    const parsed = JSON.parse(captured.join('').trim()) as Record<string, unknown>;
    expect(parsed['target']).toBe('mongodb');
  });
});
