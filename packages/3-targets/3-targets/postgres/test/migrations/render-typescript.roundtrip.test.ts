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
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AddColumnCall,
  CreateExtensionCall,
  CreateIndexCall,
  CreateSchemaCall,
  CreateTableCall,
  DropTableCall,
  RawSqlCall,
} from '../../src/core/migrations/op-factory-call';
import { TypeScriptRenderablePostgresMigration } from '../../src/core/migrations/planner-produced-postgres-migration';
import { renderOps } from '../../src/core/migrations/render-ops';

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(packageRoot, '../../../..');
const tsxPath = join(repoRoot, 'node_modules/.bin/tsx');

const targetPostgresMigrationExport = pathToFileURL(
  resolve(packageRoot, 'src/exports/migration.ts'),
).href;

const META = {
  from: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  to: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
} as const;

describe('TypeScriptRenderablePostgresMigration round-trip', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'postgres-render-roundtrip-'));
    await writeFile(join(tmpDir, 'package.json'), '{"type":"module"}');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('renders TS that re-parses to operations matching renderOps(calls) exactly', async () => {
    const calls = [
      new CreateExtensionCall('citext'),
      new CreateSchemaCall('app'),
      new CreateTableCall(
        'public',
        'user',
        [
          { name: 'id', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'email', typeSql: 'text', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      new AddColumnCall('public', 'user', {
        name: 'nickname',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
      new CreateIndexCall('public', 'user', 'user_email_idx', ['email']),
      new DropTableCall('public', 'stale'),
    ];
    const migration = new TypeScriptRenderablePostgresMigration(calls, META);

    const tsSource = migration
      .renderTypeScript()
      .replace("'@prisma-next/target-postgres/migration'", `'${targetPostgresMigrationExport}'`);
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
  });

  it('renders an empty calls list whose executed scaffold emits []', async () => {
    const migration = new TypeScriptRenderablePostgresMigration([], META);

    const tsSource = migration
      .renderTypeScript()
      .replace("'@prisma-next/target-postgres/migration'", `'${targetPostgresMigrationExport}'`);
    await writeFile(join(tmpDir, 'migration.ts'), tsSource);

    const { stderr } = await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], {
      cwd: tmpDir,
    });
    expect(stderr).toBe('');

    const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));
    expect(ops).toEqual([]);
  });

  it('preserves RawSqlCall ops byte-for-byte through the render → execute round-trip', async () => {
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
    const migration = new TypeScriptRenderablePostgresMigration(calls, META);

    const tsSource = migration
      .renderTypeScript()
      .replace("'@prisma-next/target-postgres/migration'", `'${targetPostgresMigrationExport}'`);
    await writeFile(join(tmpDir, 'migration.ts'), tsSource);

    await execFileAsync(tsxPath, [join(tmpDir, 'migration.ts')], { cwd: tmpDir });

    const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));

    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual(JSON.parse(JSON.stringify(op)));
  });
});
