import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { timeouts } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
  select: vi.fn(async () => 'postgres'),
  text: vi.fn(async () => 'src/prisma/contract.prisma'),
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

import { runInit } from '../../../src/commands/init/init';
import type { InitFlagOptions } from '../../../src/commands/init/inputs';
import type { GlobalFlags } from '../../../src/utils/global-flags';

const noninteractiveFlags = (overrides: Partial<GlobalFlags> = {}): GlobalFlags => ({
  json: false,
  quiet: true,
  verbose: 0,
  color: false,
  interactive: false,
  yes: false,
  ...overrides,
});

async function runReinit(
  tmpDir: string,
  options: Partial<InitFlagOptions> = {},
): Promise<{ code: number; warnings: string[] }> {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    if (typeof chunk === 'string') writes.push(chunk);
    else if (chunk instanceof Uint8Array) writes.push(Buffer.from(chunk).toString('utf-8'));
    return true;
  });
  try {
    const code = await runInit(tmpDir, {
      options: {
        target: 'postgres',
        authoring: 'psl',
        install: false,
        force: true,
        ...options,
      },
      flags: noninteractiveFlags({ json: true }),
      canPrompt: false,
    });
    const parsed = JSON.parse(writes.join('').trim()) as { warnings: string[] };
    return { code, warnings: parsed.warnings };
  } finally {
    spy.mockRestore();
  }
}

describe('--reinit legacy-layout warning', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pn-test-legacy-'));
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-app', version: '0.0.0', type: 'module' }, null, 2),
    );
    // Presence of prisma-next.config.ts triggers reinit path in resolveReinit.
    writeFileSync(join(tmpDir, 'prisma-next.config.ts'), 'export default {};');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    'emits no warning when prisma/ dir has no recognised legacy files',
    async () => {
      mkdirSync(join(tmpDir, 'prisma'));
      writeFileSync(join(tmpDir, 'prisma', 'README.md'), '# notes');

      const { warnings } = await runReinit(tmpDir);

      expect(warnings.join('\n')).not.toMatch(/prisma\/contract\.|prisma\/db\.ts/);
    },
    timeouts.databaseOperation,
  );

  it(
    'emits no warning when no prisma/ dir exists',
    async () => {
      const { warnings } = await runReinit(tmpDir);

      expect(warnings.join('\n')).not.toMatch(/legacy/i);
    },
    timeouts.databaseOperation,
  );

  it(
    'emits warning naming all five legacy files when all are present',
    async () => {
      mkdirSync(join(tmpDir, 'prisma'));
      for (const f of [
        'contract.prisma',
        'contract.ts',
        'contract.json',
        'contract.d.ts',
        'db.ts',
      ]) {
        writeFileSync(join(tmpDir, 'prisma', f), '');
      }

      const { warnings } = await runReinit(tmpDir);
      const text = warnings.join('\n');

      expect(text).toContain('prisma/contract.prisma');
      expect(text).toContain('prisma/contract.ts');
      expect(text).toContain('prisma/contract.json');
      expect(text).toContain('prisma/contract.d.ts');
      expect(text).toContain('prisma/db.ts');
    },
    timeouts.databaseOperation,
  );

  it(
    'warning names only files that are actually present (partial state)',
    async () => {
      mkdirSync(join(tmpDir, 'prisma'));
      writeFileSync(join(tmpDir, 'prisma', 'contract.prisma'), '');

      const { warnings } = await runReinit(tmpDir);
      const text = warnings.join('\n');

      expect(text).toContain('prisma/contract.prisma');
      expect(text).not.toContain('prisma/contract.ts');
      expect(text).not.toContain('prisma/contract.json');
      expect(text).not.toContain('prisma/contract.d.ts');
      expect(text).not.toContain('prisma/db.ts');
    },
    timeouts.databaseOperation,
  );

  it(
    'emits no warning when --reinit is not active (no config file present)',
    async () => {
      // Remove prisma-next.config.ts so resolveReinit returns false (fresh init).
      rmSync(join(tmpDir, 'prisma-next.config.ts'));
      mkdirSync(join(tmpDir, 'prisma'));
      for (const f of ['contract.prisma', 'db.ts']) {
        writeFileSync(join(tmpDir, 'prisma', f), '');
      }

      const { warnings } = await runReinit(tmpDir);
      const text = warnings.join('\n');

      expect(text).not.toContain('prisma/contract.prisma');
      expect(text).not.toContain('prisma/db.ts');
    },
    timeouts.databaseOperation,
  );
});
