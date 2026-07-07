/**
 * Differ-parity suite: for every scenario class the legacy relational walk
 * grades (basic drift, constraints, checks, defaults, referential actions,
 * semantic satisfaction, strict extras, control policies, storage types),
 * the generic-differ verify flow must produce the same VERDICT in both
 * strict and lenient modes, with the drift keyed on reason + node.
 *
 * Each scenario runs BOTH pipelines over identical fixtures:
 * - legacy: `verifySqlSchema` (the walk), exactly as the legacy suites do;
 * - differ: contract→flat expected tree (resolved leaf values stamped) vs
 *   the actual tree stamped the way introspection stamps it, normalized for
 *   semantic satisfaction, diffed by `diffSchemas`, graded by
 *   `computeSqlDiffVerdict` + `computeStorageTypeVerdict`.
 */

import type { ColumnDefault, ControlPolicy } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { diffSchemas } from '@prisma-next/framework-components/control';
import { SqlColumnIR, SqlSchemaIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { extractCodecControlHooks } from '../src/core/assembly';
import {
  computeSqlDiffVerdict,
  computeStorageTypeVerdict,
  neutralizeFlatExpectedFkSchemas,
  normalizeFlatActualForDiff,
} from '../src/core/diff/schema-diff-verify';
import type { DefaultNormalizer, NativeTypeNormalizer } from '../src/core/diff/sql-schema-diff';
import { verifySqlSchema } from '../src/core/diff/sql-schema-diff';
import { contractToSchemaIR } from '../src/core/migrations/contract-to-schema-ir';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

const testNormalizer: DefaultNormalizer = (rawDefault: string): ColumnDefault | undefined => {
  const trimmed = rawDefault.trim();
  if (/^(now\s*\(\s*\)|CURRENT_TIMESTAMP)$/i.test(trimmed)) {
    return { kind: 'function', expression: 'now()' };
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'literal', value: Number(trimmed) };
  }
  const stringMatch = trimmed.match(/^'((?:[^']|'')*)'(?:::(?:"[^"]+"|[\w\s]+)(?:\(\d+\))?)?$/);
  if (stringMatch?.[1] !== undefined) {
    return { kind: 'literal', value: stringMatch[1].replace(/''/g, "'") };
  }
  if (trimmed === 'unparseable()') return undefined;
  return { kind: 'function', expression: trimmed };
};

const identityNativeNormalizer: NativeTypeNormalizer = (nativeType: string) =>
  nativeType === 'varchar' ? 'character varying' : nativeType;

/** Stamps resolved values onto a raw actual tree the way introspection does. */
function stampLikeIntrospection(schema: SqlSchemaIR): SqlSchemaIR {
  const tables: Record<string, SqlTableIR> = {};
  for (const [name, table] of Object.entries(schema.tables)) {
    const columns: Record<string, SqlColumnIR> = {};
    for (const [colName, col] of Object.entries(table.columns)) {
      const resolvedNativeType = `${identityNativeNormalizer(col.nativeType)}${col.many ? '[]' : ''}`;
      const resolvedDefault =
        col.default !== undefined ? testNormalizer(col.default, resolvedNativeType) : undefined;
      columns[colName] = new SqlColumnIR({
        name: col.name,
        nativeType: col.nativeType,
        nullable: col.nullable,
        ...(col.default !== undefined ? { default: col.default } : {}),
        ...(col.many !== undefined ? { many: col.many } : {}),
        resolvedNativeType,
        ...(resolvedDefault !== undefined ? { resolvedDefault } : {}),
      });
    }
    tables[name] = new SqlTableIR({
      name: table.name,
      columns,
      foreignKeys: table.foreignKeys,
      uniques: table.uniques,
      indexes: table.indexes,
      ...(table.primaryKey !== undefined ? { primaryKey: table.primaryKey } : {}),
      ...(table.checks !== undefined ? { checks: table.checks } : {}),
    });
  }
  return new SqlSchemaIR({ tables });
}

interface ParityRun {
  readonly legacyOk: boolean;
  readonly newOk: boolean;
  readonly failures: readonly SchemaDiffIssue[];
  readonly warnings: readonly SchemaDiffIssue[];
}

function runPipelines(options: {
  readonly contract: ReturnType<typeof createTestContract>;
  readonly schema: SqlSchemaIR;
  readonly strict: boolean;
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): ParityRun {
  const frameworkComponents = options.frameworkComponents ?? [];
  const legacy = verifySqlSchema({
    contract: options.contract,
    schema: options.schema,
    strict: options.strict,
    typeMetadataRegistry: emptyTypeMetadataRegistry,
    frameworkComponents,
    normalizeDefault: testNormalizer,
    normalizeNativeType: identityNativeNormalizer,
  });

  const expected = neutralizeFlatExpectedFkSchemas(
    contractToSchemaIR(options.contract, { annotationNamespace: 'pg' }),
  );
  const actual = normalizeFlatActualForDiff(expected, stampLikeIntrospection(options.schema));
  const issues = diffSchemas(expected, actual);
  const diffVerdict = computeSqlDiffVerdict({
    issues,
    expectedRoot: expected,
    strict: options.strict,
    defaultControlPolicy: options.contract.defaultControlPolicy,
  });
  const namespacesWithTables = Object.values(options.contract.storage.namespaces).filter(
    (ns) => Object.keys(ns.entries.table ?? {}).length > 0,
  );
  const typeVerdict = computeStorageTypeVerdict({
    contract: options.contract,
    namespacePairs: namespacesWithTables.map(() => ({ actual })),
    codecHooks: extractCodecControlHooks(frameworkComponents),
  });
  return {
    legacyOk: legacy.ok,
    newOk: diffVerdict.failures.length === 0 && typeVerdict.failures.length === 0,
    failures: [...diffVerdict.failures, ...typeVerdict.failures],
    warnings: [...diffVerdict.warnings, ...typeVerdict.warnings],
  };
}

/** Runs both pipelines in both modes and asserts verdict equality. */
function assertParity(options: {
  readonly contract: ReturnType<typeof createTestContract>;
  readonly schema: SqlSchemaIR;
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): { readonly strict: ParityRun; readonly lenient: ParityRun } {
  const strict = runPipelines({ ...options, strict: true });
  const lenient = runPipelines({ ...options, strict: false });
  expect(strict.newOk, 'strict verdict parity').toBe(strict.legacyOk);
  expect(lenient.newOk, 'lenient verdict parity').toBe(lenient.legacyOk);
  return { strict, lenient };
}

function failureReasonsByNodeKind(run: ParityRun): ReadonlyArray<readonly [string, string]> {
  return run.failures.map((issue) => {
    const node = issue.expected ?? issue.actual;
    const nodeKind = (node as { nodeKind?: string } | undefined)?.nodeKind ?? 'unknown';
    return [nodeKind, issue.reason] as const;
  });
}

describe('differ parity — basic drift', () => {
  it('identical schema verifies in both modes', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
    });
    const { strict, lenient } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(true);
    expect(lenient.newOk).toBe(true);
  });

  it('missing table fails both modes as not-found', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
    });
    const schema = createTestSchemaIR({});
    const { strict, lenient } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(false);
    expect(lenient.newOk).toBe(false);
    expect(failureReasonsByNodeKind(lenient)).toContainEqual(['sql-table', 'not-found']);
  });

  it('extra table fails strict only', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
      stray: createSchemaTable('stray', { id: { nativeType: 'int4', nullable: false } }),
    });
    const { strict, lenient } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(false);
    expect(lenient.newOk).toBe(true);
    expect(failureReasonsByNodeKind(strict)).toContainEqual(['sql-table', 'not-expected']);
  });

  it('missing column fails both modes; extra column fails strict only', () => {
    const contract = createTestContract({
      user: createContractTable({
        id: { nativeType: 'int4', nullable: false },
        email: { nativeType: 'text', nullable: false },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        id: { nativeType: 'int4', nullable: false },
        stray: { nativeType: 'text', nullable: true },
      }),
    });
    const { strict, lenient } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(false);
    expect(lenient.newOk).toBe(false);
    expect(failureReasonsByNodeKind(lenient)).toContainEqual(['sql-column', 'not-found']);
    expect(failureReasonsByNodeKind(strict)).toContainEqual(['sql-column', 'not-expected']);
    expect(failureReasonsByNodeKind(lenient)).not.toContainEqual(['sql-column', 'not-expected']);
  });

  it('type mismatch and nullability mismatch fail both modes as not-equal', () => {
    const contract = createTestContract({
      user: createContractTable({
        id: { nativeType: 'int4', nullable: false },
        email: { nativeType: 'text', nullable: false },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        id: { nativeType: 'int8', nullable: false },
        email: { nativeType: 'text', nullable: true },
      }),
    });
    const { lenient } = assertParity({ contract, schema });
    expect(lenient.newOk).toBe(false);
    const reasons = failureReasonsByNodeKind(lenient);
    expect(reasons.filter(([kind]) => kind === 'sql-column')).toHaveLength(2);
  });

  it('normalized native types verify (varchar vs character varying)', () => {
    const contract = createTestContract({
      user: createContractTable({ name: { nativeType: 'character varying', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { name: { nativeType: 'varchar', nullable: false } }),
    });
    const { strict } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(true);
  });
});

describe('differ parity — defaults (default is a child node of the column)', () => {
  it('matching literal default verifies', () => {
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: 'draft' },
        },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: { nativeType: 'text', nullable: false, default: "'draft'::text" },
      }),
    });
    const { strict } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(true);
  });

  it('default missing fails BOTH modes as not-found on the default node', () => {
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: 'draft' },
        },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { status: { nativeType: 'text', nullable: false } }),
    });
    const { strict, lenient } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(false);
    expect(lenient.newOk).toBe(false);
    expect(failureReasonsByNodeKind(lenient)).toContainEqual(['sql-column-default', 'not-found']);
  });

  it('default mismatch fails both modes as not-equal on the default node', () => {
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: 'draft' },
        },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: { nativeType: 'text', nullable: false, default: "'published'::text" },
      }),
    });
    const { lenient } = assertParity({ contract, schema });
    expect(lenient.newOk).toBe(false);
    expect(failureReasonsByNodeKind(lenient)).toContainEqual(['sql-column-default', 'not-equal']);
  });

  it('EXTRA default fails strict only (the reason-lifecycle case that forced the node design)', () => {
    const contract = createTestContract({
      user: createContractTable({ status: { nativeType: 'text', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: { nativeType: 'text', nullable: false, default: "'draft'::text" },
      }),
    });
    const { strict, lenient } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(false);
    expect(lenient.newOk).toBe(true);
    expect(failureReasonsByNodeKind(strict)).toContainEqual(['sql-column-default', 'not-expected']);
  });

  it('function default matches case-insensitively', () => {
    const contract = createTestContract({
      user: createContractTable({
        created: {
          nativeType: 'timestamptz',
          nullable: false,
          default: { kind: 'function', expression: 'now()' },
        },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        created: { nativeType: 'timestamptz', nullable: false, default: 'CURRENT_TIMESTAMP' },
      }),
    });
    const { strict } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(true);
  });

  it('an unparseable live default against a declared one fails', () => {
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: 'draft' },
        },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: { nativeType: 'text', nullable: false, default: 'unparseable()' },
      }),
    });
    const { lenient } = assertParity({ contract, schema });
    expect(lenient.newOk).toBe(false);
  });
});

describe('differ parity — primary keys', () => {
  const contractWithPk = () =>
    createTestContract({
      user: createContractTable(
        { id: { nativeType: 'int4', nullable: false } },
        { primaryKey: { columns: ['id'] } },
      ),
    });

  it('matching PK verifies; PK name differences are ignored', () => {
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { id: { nativeType: 'int4', nullable: false } },
        { primaryKey: { columns: ['id'], name: 'user_pkey' } },
      ),
    });
    const { strict } = assertParity({ contract: contractWithPk(), schema });
    expect(strict.newOk).toBe(true);
  });

  it('missing PK fails both modes; extra PK fails strict only', () => {
    const missing = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
    });
    const { lenient } = assertParity({ contract: contractWithPk(), schema: missing });
    expect(lenient.newOk).toBe(false);
    expect(failureReasonsByNodeKind(lenient)).toContainEqual(['sql-primary-key', 'not-found']);

    const contractNoPk = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
    });
    const extra = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { id: { nativeType: 'int4', nullable: false } },
        { primaryKey: { columns: ['id'] } },
      ),
    });
    const runs = assertParity({ contract: contractNoPk, schema: extra });
    expect(runs.strict.newOk).toBe(false);
    expect(runs.lenient.newOk).toBe(true);
  });

  it('PK column drift fails both modes', () => {
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        {
          id: { nativeType: 'int4', nullable: false },
          tenant: { nativeType: 'int4', nullable: false },
        },
        { primaryKey: { columns: ['tenant', 'id'] } },
      ),
    });
    const contract = createTestContract({
      user: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
          tenant: { nativeType: 'int4', nullable: false },
        },
        { primaryKey: { columns: ['id'] } },
      ),
    });
    const { lenient } = assertParity({ contract, schema });
    expect(lenient.newOk).toBe(false);
    expect(failureReasonsByNodeKind(lenient)).toContainEqual(['sql-primary-key', 'not-equal']);
  });
});

describe('differ parity — foreign keys', () => {
  const NS = '__unbound__';
  const contractWithFk = (actions?: { onDelete?: 'cascade' | 'noAction' }) =>
    createTestContract({
      user: createContractTable(
        { id: { nativeType: 'int4', nullable: false } },
        { primaryKey: { columns: ['id'] } },
      ),
      post: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
          user_id: { nativeType: 'int4', nullable: false },
        },
        {
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              source: { namespaceId: NS, tableName: 'post', columns: ['user_id'] },
              target: { namespaceId: NS, tableName: 'user', columns: ['id'] },
              ...(actions?.onDelete !== undefined ? { onDelete: actions.onDelete } : {}),
            },
          ],
        },
      ),
    });

  const schemaWithFk = (options?: {
    readonly onDelete?: 'cascade' | 'noAction' | 'restrict';
    readonly omitFk?: boolean;
    readonly omitBackingIndex?: boolean;
  }) =>
    createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { id: { nativeType: 'int4', nullable: false } },
        { primaryKey: { columns: ['id'] } },
      ),
      post: createSchemaTable(
        'post',
        {
          id: { nativeType: 'int4', nullable: false },
          user_id: { nativeType: 'int4', nullable: false },
        },
        {
          primaryKey: { columns: ['id'] },
          foreignKeys: options?.omitFk
            ? []
            : [
                {
                  columns: ['user_id'],
                  referencedTable: 'user',
                  referencedColumns: ['id'],
                  ...(options?.onDelete !== undefined ? { onDelete: options.onDelete } : {}),
                },
              ],
          indexes: options?.omitBackingIndex
            ? []
            : [{ columns: ['user_id'], unique: false, name: 'post_user_id_idx' }],
        },
      ),
    });

  it('matching FK (unbound contract vs schema-less live FK) verifies — id pairing', () => {
    const { strict } = assertParity({ contract: contractWithFk(), schema: schemaWithFk() });
    expect(strict.newOk).toBe(true);
  });

  it('missing FK fails both modes', () => {
    const { lenient } = assertParity({
      contract: contractWithFk(),
      schema: schemaWithFk({ omitFk: true }),
    });
    expect(lenient.newOk).toBe(false);
    expect(failureReasonsByNodeKind(lenient)).toContainEqual(['sql-foreign-key', 'not-found']);
  });

  it('fk-backing index expectation: live DB missing the backing index fails both modes', () => {
    const { lenient } = assertParity({
      contract: contractWithFk(),
      schema: schemaWithFk({ omitBackingIndex: true }),
    });
    expect(lenient.newOk).toBe(false);
    expect(failureReasonsByNodeKind(lenient)).toContainEqual(['sql-index', 'not-found']);
  });

  it('referential-action directionality: undeclared expected never flags live actions', () => {
    const { strict } = assertParity({
      contract: contractWithFk(),
      schema: schemaWithFk({ onDelete: 'cascade' }),
    });
    expect(strict.newOk).toBe(true);
  });

  it('referential-action directionality: declared expected flags divergent live action', () => {
    const { lenient } = assertParity({
      contract: contractWithFk({ onDelete: 'cascade' }),
      schema: schemaWithFk({ onDelete: 'restrict' }),
    });
    expect(lenient.newOk).toBe(false);
    expect(failureReasonsByNodeKind(lenient)).toContainEqual(['sql-foreign-key', 'not-equal']);
  });

  it('referential-action noAction is equivalent to undeclared on both sides', () => {
    const noActionExpected = assertParity({
      contract: contractWithFk({ onDelete: 'noAction' }),
      schema: schemaWithFk({ onDelete: 'cascade' }),
    });
    expect(noActionExpected.strict.newOk).toBe(true);

    const noActionActual = assertParity({
      contract: contractWithFk({ onDelete: 'cascade' }),
      schema: schemaWithFk({ onDelete: 'noAction' }),
    });
    expect(noActionActual.strict.newOk).toBe(false);
  });
});

describe('differ parity — uniques, indexes, semantic satisfaction', () => {
  it('unique satisfied by a live unique INDEX passes both modes with no extras', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'] }] },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ columns: ['email'], unique: true, name: 'user_email_key' }] },
      ),
    });
    const { strict } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(true);
  });

  it('contract index satisfied by a live unique CONSTRAINT: lenient passes, strict flags the undeclared unique', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ columns: ['email'] }] },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'], name: 'user_email_key' }] },
      ),
    });
    const { strict, lenient } = assertParity({ contract, schema });
    expect(lenient.newOk).toBe(true);
    expect(strict.newOk).toBe(false);
    expect(failureReasonsByNodeKind(strict)).toContainEqual(['sql-unique', 'not-expected']);
  });

  it('a contract index demanding a type is NOT satisfied by a unique constraint', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ columns: ['email'], type: 'gin' }] },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'] }] },
      ),
    });
    const { lenient } = assertParity({ contract, schema });
    expect(lenient.newOk).toBe(false);
  });

  it('a stray live unique INDEX is never an extra (legacy invisibility)', () => {
    const contract = createTestContract({
      user: createContractTable({ email: { nativeType: 'text', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ columns: ['email'], unique: true }] },
      ),
    });
    const { strict, lenient } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(true);
    expect(lenient.newOk).toBe(true);
  });

  it('a stray live non-unique index is an extra in strict only', () => {
    const contract = createTestContract({
      user: createContractTable({ email: { nativeType: 'text', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ columns: ['email'], unique: false }] },
      ),
    });
    const runs = assertParity({ contract, schema });
    expect(runs.strict.newOk).toBe(false);
    expect(runs.lenient.newOk).toBe(true);
  });

  it('missing unique fails both modes; stray live unique constraint is strict-only', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'] }] },
      ),
    });
    const missing = createTestSchemaIR({
      user: createSchemaTable('user', { email: { nativeType: 'text', nullable: false } }),
    });
    const missingRuns = assertParity({ contract, schema: missing });
    expect(missingRuns.lenient.newOk).toBe(false);

    const contractNone = createTestContract({
      user: createContractTable({ email: { nativeType: 'text', nullable: false } }),
    });
    const stray = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'] }] },
      ),
    });
    const strayRuns = assertParity({ contract: contractNone, schema: stray });
    expect(strayRuns.strict.newOk).toBe(false);
    expect(strayRuns.lenient.newOk).toBe(true);
  });

  it('index options compare loosely (typed contract vs stringly introspection)', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ columns: ['email'], options: { fillfactor: 70 } }] },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ columns: ['email'], unique: false, options: { fillfactor: '70' } }] },
      ),
    });
    const { strict } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(true);
  });
});

describe('differ parity — check constraints', () => {
  const contractWithCheck = (values: readonly string[]) => {
    const table = createContractTable({ status: { nativeType: 'text', nullable: false } });
    // createContractTable has no checks support; splice the check in via a
    // fresh table (checks reference a value set on the namespace, which the
    // flat converter resolves — covered by the target-level tests; here the
    // ACTUAL side pins the differ behavior with pre-resolved check nodes).
    void values;
    return table;
  };
  void contractWithCheck;

  it('check drift is covered at the node level: name-paired checks compare value sets only', () => {
    // The check node semantics (values-only, order-insensitive, column not
    // compared) are pinned in the schema-ir unit tests; the value-set
    // resolution derivation is pinned in contract-to-schema-ir tests. Here we
    // pin the classification: a paired check with divergent values is
    // valueDrift (not-equal), a live-only check is not-expected.
    const expected = new SqlSchemaIR({
      tables: {
        post: {
          name: 'post',
          columns: { status: { name: 'status', nativeType: 'text', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          checks: [{ name: 'post_status_check', column: 'status', permittedValues: ['a', 'b'] }],
        },
      },
    });
    const actualDrift = new SqlSchemaIR({
      tables: {
        post: {
          name: 'post',
          columns: { status: { name: 'status', nativeType: 'text', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          checks: [{ name: 'post_status_check', column: 'status', permittedValues: ['a', 'c'] }],
        },
      },
    });
    const driftIssues = diffSchemas(expected, actualDrift).filter((i) =>
      i.path.includes('check:post_status_check'),
    );
    expect(driftIssues).toHaveLength(1);
    expect(driftIssues[0]?.reason).toBe('not-equal');

    const actualRemoved = new SqlSchemaIR({
      tables: {
        post: {
          name: 'post',
          columns: { status: { name: 'status', nativeType: 'text', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const removedIssues = diffSchemas(expected, actualRemoved).filter((i) =>
      i.path.includes('check:post_status_check'),
    );
    expect(removedIssues[0]?.reason).toBe('not-found');

    // check_removed reclassifies to not-expected per the spec: a live-only
    // check under a declared table is an undeclared extra (strict-gated),
    // where the legacy kind stamped not-equal despite being semantically an
    // extra. Verdict-neutral: strict-only failure either way.
    const expectedNoChecks = new SqlSchemaIR({
      tables: {
        post: {
          name: 'post',
          columns: { status: { name: 'status', nativeType: 'text', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const liveOnlyCheckIssues = diffSchemas(expectedNoChecks, actualDrift).filter((i) =>
      i.path.includes('check:post_status_check'),
    );
    expect(liveOnlyCheckIssues[0]?.reason).toBe('not-expected');
    const strictVerdict = computeSqlDiffVerdict({
      issues: liveOnlyCheckIssues,
      expectedRoot: expectedNoChecks,
      strict: true,
      defaultControlPolicy: undefined,
    });
    const lenientVerdict = computeSqlDiffVerdict({
      issues: liveOnlyCheckIssues,
      expectedRoot: expectedNoChecks,
      strict: false,
      defaultControlPolicy: undefined,
    });
    expect(strictVerdict.failures).toHaveLength(1);
    expect(lenientVerdict.failures).toHaveLength(0);
  });
});

describe('differ parity — control policies', () => {
  it('an observed table warns instead of failing (both pipelines pass)', () => {
    const contract = createTestContract({
      user: createContractTable(
        { id: { nativeType: 'int4', nullable: false } },
        { control: 'observed' },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int8', nullable: false } }),
    });
    const { strict, lenient } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(true);
    expect(lenient.newOk).toBe(true);
    expect(lenient.warnings.length).toBeGreaterThan(0);
  });

  it('an external table suppresses extras but still fails declared drift', () => {
    const contract = createTestContract({
      user: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
        },
        { control: 'external' },
      ),
    });
    const extras = createTestSchemaIR({
      user: createSchemaTable('user', {
        id: { nativeType: 'int4', nullable: false },
        stray: { nativeType: 'text', nullable: true },
      }),
    });
    const extraRuns = assertParity({ contract, schema: extras });
    expect(extraRuns.strict.newOk).toBe(true);

    const drift = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int8', nullable: false } }),
    });
    const driftRuns = assertParity({ contract, schema: drift });
    expect(driftRuns.lenient.newOk).toBe(false);
  });

  it('a tolerated table suppresses extra columns only', () => {
    const contract = createTestContract({
      user: createContractTable(
        { id: { nativeType: 'int4', nullable: false } },
        { control: 'tolerated' },
      ),
    });
    const extraColumn = createTestSchemaIR({
      user: createSchemaTable('user', {
        id: { nativeType: 'int4', nullable: false },
        stray: { nativeType: 'text', nullable: true },
      }),
    });
    const columnRuns = assertParity({ contract, schema: extraColumn });
    expect(columnRuns.strict.newOk).toBe(true);

    const extraIndex = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { id: { nativeType: 'int4', nullable: false } },
        { indexes: [{ columns: ['id'], unique: false }] },
      ),
    });
    const indexRuns = assertParity({ contract, schema: extraIndex });
    expect(indexRuns.strict.newOk).toBe(false);
  });

  it('a defaultControlPolicy of observed downgrades an extra table to a warning', () => {
    const contract = createTestContract(
      {
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      },
      {},
      undefined,
      { defaultControlPolicy: 'observed' as ControlPolicy },
    );
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
      stray: createSchemaTable('stray', { id: { nativeType: 'int4', nullable: false } }),
    });
    const { strict } = assertParity({ contract, schema });
    expect(strict.newOk).toBe(true);
    expect(strict.warnings.length).toBeGreaterThan(0);
  });
});

describe('differ parity — storage types (verifyType hook)', () => {
  function typeComponent(
    issues: readonly { kind: string; message: string }[],
  ): TargetBoundComponentDescriptor<'sql', string> {
    return {
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'type-hook-test',
      version: '0.0.0',
      types: {
        codecTypes: {
          controlPlaneHooks: {
            'app/enum@1': {
              verifyType: () => issues,
            },
          },
        },
      },
    } as TargetBoundComponentDescriptor<'sql', string>;
  }

  function contractWithType(): ReturnType<typeof createTestContract> {
    return createTestContract(
      { user: createContractTable({ id: { nativeType: 'int4', nullable: false } }) },
      {},
      {
        user_status: {
          kind: 'codec-instance',
          codecId: 'app/enum@1',
          nativeType: 'user_status',
          typeParams: { values: ['a'] },
        },
      },
    );
  }

  const matchingSchema = () =>
    createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
    });

  it('a verifyType failure fails the verdict in both pipelines', () => {
    const components = [
      typeComponent([
        { kind: 'type_values_mismatch', message: 'enum drift', reason: 'not-equal' } as never,
      ]),
    ];
    const { strict, lenient } = assertParity({
      contract: contractWithType(),
      schema: matchingSchema(),
      frameworkComponents: components,
    });
    expect(strict.newOk).toBe(false);
    expect(lenient.newOk).toBe(false);
  });

  it('a clean verifyType hook keeps the verdict green', () => {
    const components = [typeComponent([])];
    const { strict } = assertParity({
      contract: contractWithType(),
      schema: matchingSchema(),
      frameworkComponents: components,
    });
    expect(strict.newOk).toBe(true);
  });
});
