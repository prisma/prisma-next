/**
 * Format command (Journey F)
 *
 * Proves the three behaviours that anchor the `prisma format` slice, each
 * against a real `format` command invocation in a temp project (no database):
 *
 *   F.01 — a PSL contract source (`sourceFormat: 'psl'`) is formatted in place.
 *   F.02 — a non-PSL source (`sourceFormat: 'typescript'`) is left untouched.
 *   F.03 — unparseable PSL is refused (non-zero exit, no partial write).
 *
 * Each test writes a self-contained config + source file into the temp dir, so
 * the discriminator (`contract.source.sourceFormat`) and the on-disk effect are
 * both visible in the test body.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format } from '@prisma-next/psl-parser/format';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { runFormatWithConfig, setupJourney } from '../utils/journey-test-helpers';

// A deliberately-unformatted schema: collapsed-then-expanded whitespace, ragged
// field columns, and a second block so the formatter has real work to do.
const MESSY_PSL = `model    User    {
id     Int      @id @default(autoincrement())
email String @unique
   name String
}

enum Role {
USER
ADMIN
}`;

// Built inline rather than copied from a fixture so the source-format
// discriminator that drives the command's behaviour is visible in the test.
function pslConfig(): string {
  return `import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensionPacks: [],
  formatter: { newline: 'LF' },
  contract: prismaContract('./contract.prisma', {
    output: 'output/contract.json',
    target: postgres,
    createNamespace: postgresCreateNamespace,
  }),
});
`;
}

withTempDir(({ createTempDir }) => {
  describe('Journey F: Format command', () => {
    it(
      'F.01: formats a PSL contract source in place',
      async () => {
        const ctx = setupJourney({ createTempDir });
        const sourcePath = join(ctx.testDir, 'contract.prisma');
        writeFileSync(sourcePath, MESSY_PSL, 'utf-8');
        writeFileSync(ctx.configPath, pslConfig(), 'utf-8');

        const result = await runFormatWithConfig(ctx.testDir, ctx.configPath);

        expect(result.exitCode, 'F.01: format PSL in place').toBe(0);

        const onDisk = readFileSync(sourcePath, 'utf-8');
        const expected = format(MESSY_PSL, { indent: 2, newline: 'LF' });
        expect(onDisk, 'F.01: file rewritten to canonical form').toBe(expected);
        expect(onDisk, 'F.01: file actually changed').not.toBe(MESSY_PSL);
      },
      timeouts.coldTransformImport,
    );

    it(
      'F.02: leaves a non-PSL contract source untouched',
      async () => {
        const ctx = setupJourney({ createTempDir });
        // A source file that is byte-for-byte messy PSL on disk, but the config
        // declares the source as TypeScript — so the discriminator must skip it.
        const sourcePath = join(ctx.testDir, 'contract.prisma');
        writeFileSync(sourcePath, MESSY_PSL, 'utf-8');
        writeFileSync(
          ctx.configPath,
          `import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensionPacks: [],
  contract: {
    source: {
      sourceFormat: 'typescript',
      inputs: ['./contract.prisma'],
      load: async () => ({ ok: false as const, error: { summary: 'not loaded', diagnostics: [] } }),
    },
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
});
`,
          'utf-8',
        );

        const before = readFileSync(sourcePath, 'utf-8');
        const result = await runFormatWithConfig(ctx.testDir, ctx.configPath);

        expect(result.exitCode, 'F.02: non-PSL source exits 0').toBe(0);
        expect(result.stderr, 'F.02: reports nothing to format').toContain('Nothing to format');

        const after = readFileSync(sourcePath, 'utf-8');
        expect(after, 'F.02: source byte-identical').toBe(before);
      },
      timeouts.coldTransformImport,
    );

    it(
      'F.03: refuses unparseable PSL with a non-zero exit and no partial write',
      async () => {
        const ctx = setupJourney({ createTempDir });
        const sourcePath = join(ctx.testDir, 'contract.prisma');
        const unparseable = 'model User { this is not valid PSL @@@ ';
        writeFileSync(sourcePath, unparseable, 'utf-8');
        writeFileSync(ctx.configPath, pslConfig(), 'utf-8');

        const before = readFileSync(sourcePath, 'utf-8');
        const result = await runFormatWithConfig(ctx.testDir, ctx.configPath);

        expect(result.exitCode, 'F.03: unparseable PSL non-zero exit').not.toBe(0);

        const after = readFileSync(sourcePath, 'utf-8');
        expect(after, 'F.03: source untouched on refusal').toBe(before);
      },
      timeouts.coldTransformImport,
    );
  });
});
