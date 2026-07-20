/**
 * End-to-end round-trip for the Postgres migration authoring surface.
 *
 * Confirms that the TypeScript source produced by
 * `TypeScriptRenderablePostgresMigration#renderTypeScript()` is a
 * faithful serialization of the call list: when rewritten to point at the
 * live workspace entrypoints, written to disk, and executed via `tsx`,
 * the resulting `ops.json` matches `renderOps(calls)` exactly (modulo
 * JSON-only fields). This is the acceptance criterion that the
 * authoring surface is an invariant — a planner that emits IR, the IR
 * survives a full parse → execute round-trip back into runtime ops.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { col, primaryKey } from '@prisma-next/sql-relational-core/contract-free';
import {
  AddColumnCall,
  CreateExtensionCall,
  CreateIndexCall,
  CreatePostgresRlsPolicyCall,
  CreateSchemaCall,
  CreateTableCall,
  DisableRowLevelSecurityCall,
  DropPostgresRlsPolicyCall,
  DropTableCall,
  EnableRowLevelSecurityCall,
  RawSqlCall,
  RenamePostgresRlsPolicyCall,
} from '@prisma-next/target-postgres/op-factory-call';
import { TypeScriptRenderablePostgresMigration } from '@prisma-next/target-postgres/planner-produced-postgres-migration';
import { renderOps } from '@prisma-next/target-postgres/render-ops';
import { PostgresRlsPolicy } from '@prisma-next/target-postgres/types';
import { timeouts } from '@prisma-next/test-utils';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-lookup';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

const execFileAsync = promisify(execFile);
const testAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
const packageRoot = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(packageRoot, '../../../..');
const targetPostgresRoot = resolve(repoRoot, 'packages/3-targets/3-targets/postgres');
const tsxPath = join(repoRoot, 'node_modules/.bin/tsx');

const targetPostgresMigrationExport = pathToFileURL(
  resolve(targetPostgresRoot, 'src/exports/migration.ts'),
).href;
const relationalCoreContractFreeExport = pathToFileURL(
  resolve(repoRoot, 'packages/2-sql/4-lanes/relational-core/src/exports/contract-free.ts'),
).href;
const cliConfigTypesExport = pathToFileURL(
  resolve(repoRoot, 'packages/1-framework/3-tooling/cli/src/exports/config-types.ts'),
).href;
const familySqlControlExport = pathToFileURL(
  resolve(repoRoot, 'packages/2-sql/9-family/src/exports/control.ts'),
).href;
const targetPostgresControlExport = pathToFileURL(
  resolve(targetPostgresRoot, 'src/exports/control.ts'),
).href;
const adapterPostgresControlExport = pathToFileURL(
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
  `import postgresAdapter from '${adapterPostgresControlExport}';`,
  `import { defineConfig } from '${cliConfigTypesExport}';`,
  `import sql from '${familySqlControlExport}';`,
  `import postgres from '${targetPostgresControlExport}';`,
  '',
  'export default defineConfig({',
  '  family: sql,',
  '  target: postgres,',
  '  adapter: postgresAdapter,',
  '});',
  '',
].join('\n');

/**
 * Rewrite the bare import the renderer always emits so that running the
 * rendered scaffold from a temp directory (which has no workspace
 * `node_modules` resolution) still reaches the live in-source modules.
 * The renderer pulls both `Migration` (the base class) and
 * `MigrationCLI` (the entrypoint) from the postgres migration facade, so
 * a single rewrite is enough.
 */
function rewriteImports(tsSource: string): string {
  return tsSource
    .replace("'@prisma-next/postgres/migration'", `'${targetPostgresMigrationExport}'`)
    .replace(
      "'@prisma-next/sql-relational-core/contract-free'",
      `'${relationalCoreContractFreeExport}'`,
    );
}

/**
 * Write the committed contract fixtures the rendered scaffold imports —
 * `{start,end}-contract.json` (carrying `storage.storageHash`, which the base's
 * derived `describe()` reads) and the matching `{start,end}-contract.ts` type
 * modules (`export type Contract`). The JSON hashes match `meta` so the derived
 * describe() is consistent with the migration's identity.
 */
async function writeContractFixtures(
  dir: string,
  meta: { readonly from: string | null; readonly to: string },
): Promise<void> {
  const contractType =
    'export type Contract = { readonly storage: { readonly storageHash: string } };\n';
  await writeFile(
    join(dir, 'end-contract.json'),
    JSON.stringify({ storage: { storageHash: meta.to } }, null, 2),
  );
  await writeFile(join(dir, 'end-contract.ts'), contractType);
  if (meta.from !== null) {
    await writeFile(
      join(dir, 'start-contract.json'),
      JSON.stringify({ storage: { storageHash: meta.from } }, null, 2),
    );
    await writeFile(join(dir, 'start-contract.ts'), contractType);
  }
}

const META = {
  from: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  to: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
} as const;

describe('TypeScriptRenderablePostgresMigration round-trip', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'postgres-render-roundtrip-'));
    await writeFile(join(tmpDir, 'package.json'), '{"type":"module"}');
    await writeFile(join(tmpDir, 'prisma-next.config.ts'), fixtureConfigSource);
    // The rendered scaffold imports its from/to identity from committed
    // contract JSON (the base derives describe() from `storage.storageHash`)
    // and the matching `Contract` types. Write minimal fixtures so the
    // executed migration resolves its imports; the from/to hashes here match
    // META so the derived describe() is consistent.
    await writeContractFixtures(tmpDir, META);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  }, timeouts.databaseOperation);

  it('renders TS that re-parses to operations matching renderOps(calls) exactly', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const calls = [
      new CreateExtensionCall('citext'),
      new CreateSchemaCall('app'),
      new CreateTableCall(
        'public',
        'user',
        [col('id', 'text', { notNull: true }), col('email', 'text', { notNull: true })],
        [primaryKey(['id'])],
      ),
      new AddColumnCall('public', 'user', col('nickname', 'text')),
      new CreateIndexCall('public', 'user', 'user_email_idx', ['email']),
      new EnableRowLevelSecurityCall('public', 'user'),
      new CreatePostgresRlsPolicyCall(
        'public',
        'user',
        new PostgresRlsPolicy({
          name: 'p_ab12cd34',
          prefix: 'p',
          tableName: 'user',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: '(id = auth.uid())',
          withCheck: '(id = auth.uid())',
          permissive: true,
        }),
      ),
      new RenamePostgresRlsPolicyCall('public', 'user', 'p_ab12cd34', 'p_e5f6a7b8'),
      new DropPostgresRlsPolicyCall('public', 'user', 'p_e5f6a7b8'),
      new DisableRowLevelSecurityCall('public', 'user'),
      new DropTableCall('public', 'stale'),
    ];
    const migration = new TypeScriptRenderablePostgresMigration(
      calls,
      META,
      APP_SPACE_ID,
      testAdapter,
    );

    const tsSource = rewriteImports(migration.renderTypeScript());
    await writeFile(join(tmpDir, 'migration.ts'), tsSource);

    const { stdout, stderr } = await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
      cwd: tmpDir,
    });
    expect(stderr).toBe('');
    expect(stdout).toContain('Wrote ops.json + migration.json to ');

    const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
    const ops = JSON.parse(opsJson);

    const expected = await Promise.all(renderOps(calls, testAdapter));
    expect(ops).toEqual(expected);
  });

  it('renders an empty calls list whose executed scaffold emits []', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const migration = new TypeScriptRenderablePostgresMigration([], META, APP_SPACE_ID);

    const tsSource = rewriteImports(migration.renderTypeScript());
    await writeFile(join(tmpDir, 'migration.ts'), tsSource);

    const { stderr } = await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
      cwd: tmpDir,
    });
    expect(stderr).toBe('');

    const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));
    expect(ops).toEqual([]);
  });

  it('preserves RawSqlCall ops byte-for-byte through the render → execute round-trip', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const op = {
      id: 'raw.custom.1',
      label: 'raw custom 1',
      operationClass: 'additive' as const,
      target: { id: 'postgres' as const },
      precheck: [],
      execute: [{ description: 'do thing', sql: 'SELECT 1' }],
      postcheck: [],
      meta: { note: 'preserved' },
    };
    const calls = [new RawSqlCall(op)];
    const migration = new TypeScriptRenderablePostgresMigration(calls, META, APP_SPACE_ID);

    const tsSource = rewriteImports(migration.renderTypeScript());
    await writeFile(join(tmpDir, 'migration.ts'), tsSource);

    await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
      cwd: tmpDir,
    });

    const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));

    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual(JSON.parse(JSON.stringify(op)));
  });
});
