/**
 * End-to-end round-trip for the SQLite migration authoring surface.
 *
 * Confirms that the TypeScript source produced by
 * `TypeScriptRenderableSqliteMigration#renderTypeScript()` is a faithful
 * serialization of the call list: when rewritten to point at the live
 * workspace entrypoints, written to disk, and executed via `tsx`, the
 * resulting `ops.json` matches `renderOps(calls)` exactly. Mirrors the
 * Postgres `render-typescript.roundtrip.test.ts`.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
  DropTableCall,
  RecreateTableCall,
} from '@prisma-next/target-sqlite/op-factory-call';
import { TypeScriptRenderableSqliteMigration } from '@prisma-next/target-sqlite/planner-produced-sqlite-migration';
import { renderOps } from '@prisma-next/target-sqlite/render-ops';
import { timeouts } from '@prisma-next/test-utils';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(packageRoot, '../../../..');
const targetSqliteRoot = resolve(repoRoot, 'packages/3-targets/3-targets/sqlite');
const tsxPath = join(repoRoot, 'node_modules/.bin/tsx');

const targetSqliteMigrationExport = pathToFileURL(
  resolve(targetSqliteRoot, 'src/exports/migration.ts'),
).href;
const cliConfigTypesExport = pathToFileURL(
  resolve(repoRoot, 'packages/1-framework/3-tooling/cli/src/exports/config-types.ts'),
).href;
const familySqlControlExport = pathToFileURL(
  resolve(repoRoot, 'packages/2-sql/9-family/src/exports/control.ts'),
).href;
const targetSqliteControlExport = pathToFileURL(
  resolve(targetSqliteRoot, 'src/exports/control.ts'),
).href;
const adapterSqliteControlExport = pathToFileURL(
  resolve(packageRoot, 'src/exports/control.ts'),
).href;

/**
 * `MigrationCLI.run` requires a `prisma-next.config.ts` to assemble a
 * `ControlStack`. Tests have no workspace `node_modules` resolution from
 * `tmpDir`, so we write a bespoke config alongside `migration.ts` whose
 * imports all use absolute `file://` URLs into the live workspace
 * sources. The driver is omitted — the round-trip exercises the
 * serialization path only and never opens a database connection.
 */
const fixtureConfigSource = [
  `import sqliteAdapter from '${adapterSqliteControlExport}';`,
  `import { defineConfig } from '${cliConfigTypesExport}';`,
  `import sql from '${familySqlControlExport}';`,
  `import sqlite from '${targetSqliteControlExport}';`,
  '',
  'export default defineConfig({',
  '  family: sql,',
  '  target: sqlite,',
  '  adapter: sqliteAdapter,',
  '});',
  '',
].join('\n');

/**
 * Rewrite the bare import the renderer always emits so that running the
 * rendered scaffold from a temp directory (which has no workspace
 * `node_modules` resolution) still reaches the live in-source modules.
 * The renderer pulls both `Migration` (the base class) and `MigrationCLI`
 * (the entrypoint) from the sqlite migration facade, so a single rewrite
 * is enough.
 */
function rewriteImports(tsSource: string): string {
  return tsSource.replace(
    "'@prisma-next/target-sqlite/migration'",
    `'${targetSqliteMigrationExport}'`,
  );
}

const META = {
  from: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  to: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
} as const;

describe('TypeScriptRenderableSqliteMigration round-trip', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sqlite-render-roundtrip-'));
    await writeFile(join(tmpDir, 'package.json'), '{"type":"module"}');
    await writeFile(join(tmpDir, 'prisma-next.config.ts'), fixtureConfigSource);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it(
    'renders TS that re-parses to operations matching renderOps(calls) exactly',
    { timeout: timeouts.typeScriptCompilation },
    async () => {
      const calls = [
        new CreateTableCall('user', {
          columns: [
            {
              name: 'id',
              typeSql: 'INTEGER',
              defaultSql: '',
              nullable: false,
              inlineAutoincrementPrimaryKey: true,
            },
            { name: 'email', typeSql: 'TEXT', defaultSql: '', nullable: false },
          ],
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'], name: 'uq_user_email' }],
          foreignKeys: [],
        }),
        new AddColumnCall('user', {
          name: 'nickname',
          typeSql: 'TEXT',
          defaultSql: '',
          nullable: true,
        }),
        new CreateIndexCall('user', 'user_email_idx', ['email']),
        new DropTableCall('stale'),
      ];
      const migration = new TypeScriptRenderableSqliteMigration(calls, META);

      const tsSource = rewriteImports(migration.renderTypeScript());
      await writeFile(join(tmpDir, 'migration.ts'), tsSource);

      const { stdout, stderr } = await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
        cwd: tmpDir,
      });
      expect(stderr).toBe('');
      expect(stdout).toContain('Wrote ops.json + migration.json to ');

      const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
      const ops = JSON.parse(opsJson);

      const expected = JSON.parse(JSON.stringify(renderOps(calls)));
      expect(ops).toEqual(expected);
    },
  );

  it(
    'renders an empty calls list whose executed scaffold emits []',
    { timeout: timeouts.typeScriptCompilation },
    async () => {
      const migration = new TypeScriptRenderableSqliteMigration([], META);

      const tsSource = rewriteImports(migration.renderTypeScript());
      await writeFile(join(tmpDir, 'migration.ts'), tsSource);

      const { stderr } = await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
        cwd: tmpDir,
      });
      expect(stderr).toBe('');

      const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));
      expect(ops).toEqual([]);
    },
  );

  it(
    'preserves RecreateTableCall through the render → execute round-trip',
    { timeout: timeouts.typeScriptCompilation },
    async () => {
      const calls = [
        new RecreateTableCall({
          tableName: 'user',
          contractTable: {
            columns: [
              { name: 'id', typeSql: 'INTEGER', defaultSql: '', nullable: false },
              { name: 'email', typeSql: 'TEXT', defaultSql: '', nullable: true },
            ],
            primaryKey: { columns: ['id'] },
            uniques: [],
            foreignKeys: [],
          },
          schemaColumnNames: ['id', 'email'],
          indexes: [{ name: 'idx_user_email', columns: ['email'] }],
          issues: [
            {
              kind: 'nullability_mismatch',
              table: 'user',
              column: 'email',
              expected: 'true',
              actual: 'false',
              message: 'm',
            },
          ],
          operationClass: 'widening',
        }),
      ];
      const migration = new TypeScriptRenderableSqliteMigration(calls, META);

      const tsSource = rewriteImports(migration.renderTypeScript());
      await writeFile(join(tmpDir, 'migration.ts'), tsSource);

      await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], { cwd: tmpDir });

      const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));

      const expected = JSON.parse(JSON.stringify(renderOps(calls)));
      expect(ops).toEqual(expected);
    },
  );
});
