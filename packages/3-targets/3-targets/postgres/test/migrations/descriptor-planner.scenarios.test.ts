/**
 * Descriptor planner scenario tests — transient regression coverage.
 *
 * After Phase 3's capability flip, `planWithDescriptors` is no longer registered
 * on the Postgres `TargetMigrationsCapability`. These tests now hand-assemble the
 * descriptor pipeline (`contractToSchemaIR` → `verifySqlSchema` → `planDescriptors`
 * called directly) to guard against regressions in `planDescriptors` and the
 * descriptor strategies while they still ship in the module. Once the descriptor
 * flow is deleted in a later phase, this file goes with it.
 *
 * See descriptor-planner.scenarios.md for the full scenario list.
 */

import postgresAdapterDescriptor, {
  normalizeSchemaNativeType,
  parsePostgresDefault,
} from '@prisma-next/adapter-postgres/control';
import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import pgvectorDescriptor from '@prisma-next/extension-pgvector/control';
import { contractToSchemaIR } from '@prisma-next/family-sql/control';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ForeignKey,
  Index,
  SqlStorage,
  StorageColumn,
  StorageTable,
  UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';
import { planDescriptors } from '../../src/core/migrations/issue-planner';
import postgresTargetDescriptor, { postgresRenderDefault } from '../../src/exports/control';

// ============================================================================
// Test helpers
// ============================================================================

const defaultComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>> = [
  postgresTargetDescriptor as TargetBoundComponentDescriptor<'sql', 'postgres'>,
  postgresAdapterDescriptor as TargetBoundComponentDescriptor<'sql', 'postgres'>,
];

function col(
  nativeType: string,
  codecId: string,
  opts?: {
    nullable?: boolean;
    default?: StorageColumn['default'];
    typeParams?: Record<string, unknown>;
    typeRef?: string;
  },
): StorageColumn {
  return {
    nativeType,
    codecId,
    nullable: opts?.nullable ?? false,
    ...(opts?.default !== undefined ? { default: opts.default } : {}),
    ...(opts?.typeParams !== undefined ? { typeParams: opts.typeParams } : {}),
    ...(opts?.typeRef !== undefined ? { typeRef: opts.typeRef } : {}),
  };
}

const textCol = (opts?: { nullable?: boolean; default?: StorageColumn['default'] }) =>
  col('text', 'pg/text@1', opts);
const intCol = (opts?: { nullable?: boolean; default?: StorageColumn['default'] }) =>
  col('int4', 'pg/int4@1', opts);
const uuidCol = (opts?: { nullable?: boolean }) => col('uuid', 'pg/uuid@1', opts);
const boolCol = (opts?: { nullable?: boolean; default?: StorageColumn['default'] }) =>
  col('boolean', 'pg/bool@1', opts);
function table(
  columns: Record<string, StorageColumn>,
  opts?: {
    primaryKey?: { columns: string[] };
    uniques?: UniqueConstraint[];
    indexes?: Index[];
    foreignKeys?: ForeignKey[];
  },
): StorageTable {
  return {
    columns,
    primaryKey: opts?.primaryKey ?? { columns: [Object.keys(columns)[0]!] },
    uniques: opts?.uniques ?? [],
    indexes: opts?.indexes ?? [],
    foreignKeys: opts?.foreignKeys ?? [],
  };
}

function contract(
  tables: Record<string, StorageTable>,
  extras?: { types?: Contract<SqlStorage>['storage']['types'] },
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: {
      tables,
      storageHash: coreHash(`sha256:${JSON.stringify(tables)}`),
      ...ifDefined('types', extras?.types),
    },
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function plan(
  from: Contract<SqlStorage> | null,
  to: Contract<SqlStorage>,
  _components?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>>,
) {
  const fromSchemaIR = contractToSchemaIR(from, {
    annotationNamespace: 'pg',
    renderDefault: postgresRenderDefault,
    frameworkComponents: _components ?? defaultComponents,
  });
  const verifyResult = verifySqlSchema({
    contract: to,
    schema: fromSchemaIR,
    strict: true,
    typeMetadataRegistry: new Map(),
    frameworkComponents: _components ?? defaultComponents,
    normalizeDefault: parsePostgresDefault,
    normalizeNativeType: normalizeSchemaNativeType,
  });
  const planResult = planDescriptors({
    issues: verifyResult.schema.issues,
    toContract: to,
    fromContract: from,
  });
  if (!planResult.ok) {
    return { ok: false as const, conflicts: planResult.failure };
  }
  return { ok: true as const, descriptors: planResult.value.descriptors };
}

function descriptorKinds(result: { ok: true; descriptors: readonly { kind: string }[] }) {
  return result.descriptors.map((d) => d.kind);
}

function descriptorSummary(result: { ok: true; descriptors: readonly Record<string, unknown>[] }) {
  return result.descriptors.map((d) => {
    const parts = [d['kind']];
    if (d['table']) parts.push(d['table'] as string);
    if (d['column']) parts.push(d['column'] as string);
    if (d['typeName']) parts.push(d['typeName'] as string);
    if (d['dependencyId']) parts.push(d['dependencyId'] as string);
    return parts.join('.');
  });
}

// ============================================================================
// Additive — fresh database (from = null)
// ============================================================================

describe('additive — fresh database', () => {
  it('1: single table with columns + PK', () => {
    const to = contract({
      user: table({ id: uuidCol(), email: textCol() }),
    });
    const result = plan(null, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['createTable']);
  });

  it('2: table with FK + backing index', () => {
    const to = contract({
      user: table({ id: uuidCol(), email: textCol() }),
      post: table(
        { id: uuidCol(), userId: uuidCol(), title: textCol() },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        },
      ),
    });
    const result = plan(null, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorSummary(result)).toEqual([
      'createTable.user',
      'createTable.post',
      'addForeignKey.post',
      'createIndex.post',
    ]);
  });

  it('3: table with explicit indexes and uniques', () => {
    const to = contract({
      user: table(
        { id: uuidCol(), email: textCol(), name: textCol() },
        {
          uniques: [{ columns: ['email'] }],
          indexes: [{ columns: ['name'] }],
        },
      ),
    });
    const result = plan(null, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorSummary(result)).toEqual([
      'createTable.user',
      'createIndex.user',
      'addUnique.user',
    ]);
  });

  it('4: table with enum type column', () => {
    const to = contract(
      {
        user: table({
          id: uuidCol(),
          role: col('user_role', 'pg/enum@1'),
        }),
      },
      {
        types: {
          UserRole: {
            codecId: 'pg/enum@1',
            nativeType: 'user_role',
            typeParams: { values: ['admin', 'user'] },
          },
        },
      },
    );
    const result = plan(null, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toContain('createEnumType');
    expect(descriptorKinds(result)).toContain('createTable');
  });

  it('5: multiple tables with FK between them', () => {
    const to = contract({
      user: table({ id: uuidCol(), email: textCol() }),
      post: table(
        { id: uuidCol(), userId: uuidCol(), title: textCol() },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        },
      ),
      comment: table(
        { id: uuidCol(), postId: uuidCol(), body: textCol() },
        {
          foreignKeys: [
            {
              columns: ['postId'],
              references: { table: 'post', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        },
      ),
    });
    const result = plan(null, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = descriptorKinds(result);
    expect(kinds.filter((k) => k === 'createTable')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'addForeignKey')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'createIndex')).toHaveLength(2);
  });
});

// ============================================================================
// Additive — existing contract
// ============================================================================

describe('additive — existing contract', () => {
  const base = contract({
    user: table({ id: uuidCol(), email: textCol() }),
  });

  it('6: new nullable column', () => {
    const to = contract({
      user: table({ id: uuidCol(), email: textCol(), bio: textCol({ nullable: true }) }),
    });
    const result = plan(base, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorSummary(result)).toEqual(['addColumn.user.bio']);
  });

  it('7: new NOT NULL column with default', () => {
    const to = contract({
      user: table({
        id: uuidCol(),
        email: textCol(),
        active: boolCol({ default: { kind: 'literal', value: true } }),
      }),
    });
    const result = plan(base, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorSummary(result)).toEqual(['addColumn.user.active']);
  });

  it('8: new NOT NULL column without default → data migration', () => {
    const to = contract({
      user: table({ id: uuidCol(), email: textCol(), name: textCol() }),
    });
    const result = plan(base, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorSummary(result)).toEqual([
      'addColumn.user.name',
      'dataTransform',
      'setNotNull.user.name',
    ]);
    // addColumn should have nullable override
    const addCol = result.descriptors[0] as Record<string, unknown>;
    expect(addCol['overrides']).toEqual({ nullable: true });
  });

  it('9: multiple NOT NULL columns without defaults', () => {
    const to = contract({
      user: table({ id: uuidCol(), email: textCol(), firstName: textCol(), lastName: textCol() }),
    });
    const result = plan(base, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = descriptorKinds(result);
    expect(kinds.filter((k) => k === 'dataTransform')).toHaveLength(2);
  });

  it('10: new table alongside existing (existing untouched)', () => {
    const to = contract({
      user: table({ id: uuidCol(), email: textCol() }),
      post: table({ id: uuidCol(), title: textCol() }),
    });
    const result = plan(base, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorSummary(result)).toEqual(['createTable.post']);
  });

  it('11: new FK column on existing table', () => {
    const from = contract({
      user: table({ id: uuidCol(), email: textCol() }),
      post: table({ id: uuidCol(), title: textCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), email: textCol() }),
      post: table(
        { id: uuidCol(), title: textCol(), userId: uuidCol() },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        },
      ),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = descriptorSummary(result);
    expect(summary).toContain('addColumn.post.userId');
    expect(summary).toContain('addForeignKey.post');
    expect(summary).toContain('createIndex.post');
  });
});

// ============================================================================
// Reconciliation — drops
// ============================================================================

describe('reconciliation — drops', () => {
  it('12: drop table', () => {
    const from = contract({
      user: table({ id: uuidCol(), email: textCol() }),
      post: table({ id: uuidCol(), title: textCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), email: textCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorSummary(result)).toEqual(['dropTable.post']);
  });

  it('13: drop column', () => {
    const from = contract({
      user: table({ id: uuidCol(), email: textCol(), name: textCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), email: textCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorSummary(result)).toEqual(['dropColumn.user.name']);
  });

  it('14: drop index', () => {
    const from = contract({
      user: table(
        { id: uuidCol(), email: textCol() },
        { indexes: [{ columns: ['email'], name: 'user_email_idx' }] },
      ),
    });
    const to = contract({
      user: table({ id: uuidCol(), email: textCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['dropIndex']);
  });

  it('15: drop FK', () => {
    const from = contract({
      user: table({ id: uuidCol() }),
      post: table(
        { id: uuidCol(), userId: uuidCol() },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        },
      ),
    });
    const to = contract({
      user: table({ id: uuidCol() }),
      post: table({ id: uuidCol(), userId: uuidCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = descriptorKinds(result);
    expect(kinds).toContain('dropConstraint');
    expect(kinds).toContain('dropIndex');
  });

  it('16: drop unique constraint', () => {
    const from = contract({
      user: table({ id: uuidCol(), email: textCol() }, { uniques: [{ columns: ['email'] }] }),
    });
    const to = contract({
      user: table({ id: uuidCol(), email: textCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['dropConstraint']);
  });

  it('17: drop default', () => {
    const from = contract({
      user: table({
        id: uuidCol(),
        active: boolCol({ default: { kind: 'literal', value: true } }),
      }),
    });
    const to = contract({
      user: table({ id: uuidCol(), active: boolCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['dropDefault']);
  });
});

// ============================================================================
// Reconciliation — alters
// ============================================================================

describe('reconciliation — alters', () => {
  it('18: safe widening type change (int4 → int8) — alterColumnType, no data migration', () => {
    const from = contract({
      user: table({ id: uuidCol(), age: intCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), age: col('int8', 'pg/int8@1') }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorSummary(result)).toEqual(['alterColumnType.user.age']);
  });

  it('18b: unsafe type change (text → int4) — dataTransform + alterColumnType', () => {
    const from = contract({
      user: table({ id: uuidCol(), score: textCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), score: intCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['dataTransform', 'alterColumnType']);
  });

  it('19: nullable → NOT NULL — dataTransform + setNotNull (existing NULLs may violate)', () => {
    const from = contract({
      user: table({ id: uuidCol(), name: textCol({ nullable: true }) }),
    });
    const to = contract({
      user: table({ id: uuidCol(), name: textCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['dataTransform', 'setNotNull']);
    const dt = result.descriptors[0] as Record<string, unknown>;
    expect(dt['name']).toBe('handle-nulls-user-name');
  });

  it('20: NOT NULL → nullable', () => {
    const from = contract({
      user: table({ id: uuidCol(), name: textCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), name: textCol({ nullable: true }) }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorSummary(result)).toEqual(['dropNotNull.user.name']);
  });

  it('21: default changed', () => {
    const from = contract({
      user: table({
        id: uuidCol(),
        active: boolCol({ default: { kind: 'literal', value: true } }),
      }),
    });
    const to = contract({
      user: table({
        id: uuidCol(),
        active: boolCol({ default: { kind: 'literal', value: false } }),
      }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['setDefault']);
  });

  it('22: default added', () => {
    const from = contract({
      user: table({ id: uuidCol(), active: boolCol() }),
    });
    const to = contract({
      user: table({
        id: uuidCol(),
        active: boolCol({ default: { kind: 'literal', value: true } }),
      }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['setDefault']);
  });

  it('23: default removed', () => {
    const from = contract({
      user: table({
        id: uuidCol(),
        active: boolCol({ default: { kind: 'literal', value: true } }),
      }),
    });
    const to = contract({
      user: table({ id: uuidCol(), active: boolCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['dropDefault']);
  });
});

// ============================================================================
// Types
// ============================================================================

describe('types', () => {
  const enumType = (values: string[]) => ({
    codecId: 'pg/enum@1' as const,
    nativeType: 'user_role',
    typeParams: { values },
  });

  it('24: new enum type', () => {
    const to = contract(
      { user: table({ id: uuidCol(), role: col('user_role', 'pg/enum@1') }) },
      { types: { UserRole: enumType(['admin', 'user']) } },
    );
    const result = plan(null, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const enumDesc = result.descriptors.find((d) => d.kind === 'createEnumType');
    expect(enumDesc).toBeDefined();
    expect((enumDesc as Record<string, unknown>)['typeName']).toBe('UserRole');
    // createEnumType should come before createTable
    const kinds = descriptorKinds(result);
    expect(kinds.indexOf('createEnumType')).toBeLessThan(kinds.indexOf('createTable'));
  });

  it('25: enum values added → addEnumValues', () => {
    const from = contract(
      { user: table({ id: uuidCol(), role: col('user_role', 'pg/enum@1') }) },
      { types: { UserRole: enumType(['admin']) } },
    );
    const to = contract(
      { user: table({ id: uuidCol(), role: col('user_role', 'pg/enum@1') }) },
      { types: { UserRole: enumType(['admin', 'user']) } },
    );
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['addEnumValues']);
    const desc = result.descriptors[0] as unknown as {
      typeName: string;
      values: readonly string[];
    };
    expect(desc.typeName).toBe('UserRole');
    expect(desc.values).toEqual(['user']);
  });

  it('26: enum values removed → dataTransform + enum rebuild recipe', () => {
    const from = contract(
      {
        user: table({
          id: uuidCol(),
          role: col('user_role', 'pg/enum@1', { typeRef: 'UserRole' }),
        }),
      },
      { types: { UserRole: enumType(['admin', 'user']) } },
    );
    const to = contract(
      {
        user: table({
          id: uuidCol(),
          role: col('user_role', 'pg/enum@1', { typeRef: 'UserRole' }),
        }),
      },
      { types: { UserRole: enumType(['admin']) } },
    );
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual([
      'dataTransform',
      'createEnumType',
      'alterColumnType',
      'dropEnumType',
      'renameType',
    ]);
  });

  // Verifier doesn't produce type_missing for types referenced by a missing_table — the type
  // is silently created as part of createTable. Needs verifier-level unknown codec detection.
  it.fails('27: unknown codec type missing → conflict', () => {
    const to = contract(
      { user: table({ id: uuidCol(), data: col('custom_type', 'unknown/codec@1') }) },
      {
        types: {
          CustomType: {
            codecId: 'unknown/codec@1',
            nativeType: 'custom_type',
            typeParams: { foo: 'bar' },
          },
        },
      },
    );
    const result = plan(null, to);
    // Should fail with conflict about unsupported codec type
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflicts[0]?.summary).toContain('codec');
  });
});

// ============================================================================
// Dependencies
// ============================================================================

describe('dependencies', () => {
  const componentsWithPgvector: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>> = [
    ...defaultComponents,
    pgvectorDescriptor as TargetBoundComponentDescriptor<'sql', 'postgres'>,
  ];

  it('28: missing database dependency → createDependency', () => {
    const to = contract({
      post: table({ id: uuidCol(), embedding: col('vector', 'pg/vector@1', { nullable: true }) }),
    });
    const result = plan(null, to, componentsWithPgvector);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const depDesc = result.descriptors.find((d) => d.kind === 'createDependency');
    expect(depDesc).toBeDefined();
    expect((depDesc as Record<string, unknown>)['dependencyId']).toBe('postgres.extension.vector');
  });

  it('28b: pgvector dependency comes before table using vector column', () => {
    const to = contract({
      post: table({
        id: uuidCol(),
        title: textCol(),
        embedding: col('vector', 'pg/vector@1', { nullable: true }),
      }),
    });
    const result = plan(null, to, componentsWithPgvector);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = descriptorKinds(result);
    expect(kinds).toContain('createDependency');
    expect(kinds).toContain('createTable');
    expect(kinds.indexOf('createDependency')).toBeLessThan(kinds.indexOf('createTable'));
  });
});

// ============================================================================
// Ordering
// ============================================================================

describe('ordering', () => {
  it('30: types and deps before tables', () => {
    const componentsWithPgvector: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>> =
      [
        ...defaultComponents,
        pgvectorDescriptor as TargetBoundComponentDescriptor<'sql', 'postgres'>,
      ];
    const to = contract(
      {
        user: table({ id: uuidCol(), role: col('user_role', 'pg/enum@1') }),
        post: table({ id: uuidCol(), embedding: col('vector', 'pg/vector@1', { nullable: true }) }),
      },
      {
        types: {
          UserRole: {
            codecId: 'pg/enum@1',
            nativeType: 'user_role',
            typeParams: { values: ['admin', 'user'] },
          },
        },
      },
    );
    const result = plan(null, to, componentsWithPgvector);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = descriptorKinds(result);
    // createEnumType and createDependency should come before any createTable
    const firstTable = kinds.indexOf('createTable');
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === 'createEnumType' || kinds[i] === 'createDependency') {
        expect(i).toBeLessThan(firstTable);
      }
    }
  });

  it('29: drops before creates', () => {
    const from = contract({
      old_table: table({ id: uuidCol() }),
    });
    const to = contract({
      new_table: table({ id: uuidCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = descriptorKinds(result);
    const dropIdx = kinds.indexOf('dropTable');
    const createIdx = kinds.indexOf('createTable');
    expect(dropIdx).toBeLessThan(createIdx);
  });

  it('31: tables before columns', () => {
    const from = contract({
      user: table({ id: uuidCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), email: textCol({ nullable: true }) }),
      post: table({ id: uuidCol(), title: textCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = descriptorKinds(result);
    const tableIdx = kinds.indexOf('createTable');
    const colIdx = kinds.indexOf('addColumn');
    expect(tableIdx).toBeLessThan(colIdx);
  });

  it('32: pattern ops between columns and constraints', () => {
    const from = contract({
      user: table({ id: uuidCol(), email: textCol() }),
    });
    const to = contract({
      user: table(
        { id: uuidCol(), email: textCol(), name: textCol() },
        { uniques: [{ columns: ['name'] }] },
      ),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // name is NOT NULL without default → pattern match
    // addColumn(nullable) → dataTransform → setNotNull, then addUnique after
    const kinds = descriptorKinds(result);
    const dtIdx = kinds.indexOf('dataTransform');
    const uniqueIdx = kinds.indexOf('addUnique');
    expect(dtIdx).toBeLessThan(uniqueIdx);
  });
});

// ============================================================================
// Combined / realistic
// ============================================================================

describe('combined / realistic', () => {
  it('34: vertical table split (S5) — new table with FK to existing', () => {
    const from = contract({
      user: table({
        id: uuidCol(),
        email: textCol(),
        bio: textCol({ nullable: true }),
        avatarUrl: textCol({ nullable: true }),
      }),
    });
    const to = contract({
      user: table({ id: uuidCol(), email: textCol() }),
      user_profile: table(
        {
          id: uuidCol(),
          userId: uuidCol(),
          bio: textCol({ nullable: true }),
          avatarUrl: textCol({ nullable: true }),
        },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        },
      ),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = descriptorSummary(result);
    expect(summary).toContain('dropColumn.user.bio');
    expect(summary).toContain('dropColumn.user.avatarUrl');
    expect(summary).toContain('createTable.user_profile');
    expect(summary).toContain('addForeignKey.user_profile');
    expect(summary).toContain('createIndex.user_profile');
  });

  it('36: no-op — identical contracts', () => {
    const c = contract({
      user: table({ id: uuidCol(), email: textCol() }),
    });
    const result = plan(c, c);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.descriptors).toEqual([]);
  });
});

// ============================================================================
// Old planner parity
// ============================================================================

describe('old planner parity', () => {
  it('37: NOT NULL without default produces dataTransform, not temp default', () => {
    const from = contract({
      user: table({ id: uuidCol(), email: textCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), email: textCol(), age: intCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toContain('dataTransform');
    // Should NOT contain a plain addColumn (that would apply NOT NULL directly)
    const plainAddCol = result.descriptors.find(
      (d) => d.kind === 'addColumn' && !(d as Record<string, unknown>)['overrides'],
    );
    expect(plainAddCol).toBeUndefined();
  });

  it('38: column with typeParams (char(36)) resolves correctly', () => {
    const to = contract({
      user: table({
        id: col('character', 'sql/char@1', { typeParams: { length: 36 } }),
        email: textCol(),
      }),
    });
    const result = plan(null, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['createTable']);
  });
});

// ============================================================================
// Data-safety gaps — scenarios that SHOULD detect data migration needs
// These tests document expected behavior we haven't implemented yet.
// ============================================================================

describe('data-safety gaps', () => {
  it('S1: computed backfill — NOT NULL column on non-empty table needs data migration', () => {
    // This is handled by the notNullBackfillStrategy (test 8)
    // Verify the dataTransform has a meaningful structure
    const from = contract({
      user: table({ id: uuidCol(), email: textCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), email: textCol(), displayName: textCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dt = result.descriptors.find((d) => d.kind === 'dataTransform') as
      | Record<string, unknown>
      | undefined;
    expect(dt).toBeDefined();
    expect(dt!['name']).toBe('backfill-user-displayName');
  });

  it('S2: type change (text → int) emits dataTransform + alterColumnType via typeChangeStrategy', () => {
    const from = contract({
      user: table({ id: uuidCol(), foo: textCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), foo: intCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['dataTransform', 'alterColumnType']);
  });

  it('S2b: lossy type change (float → int) emits dataTransform + alterColumnType', () => {
    const from = contract({
      product: table({ id: uuidCol(), price: col('float8', 'pg/float8@1') }),
    });
    const to = contract({
      product: table({ id: uuidCol(), price: col('int4', 'pg/int4@1') }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(descriptorKinds(result)).toEqual(['dataTransform', 'alterColumnType']);
  });

  // Descriptor ordering: dropColumn comes before pattern ops (dataTransform) instead of after.
  // Needs a phase ordering fix so drops happen after pattern ops for column split scenarios.
  it.fails('S3: column split (name → firstName + lastName) — new NOT NULL columns detected', () => {
    const from = contract({
      user: table({ id: uuidCol(), name: textCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), firstName: textCol(), lastName: textCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should detect 2 NOT NULL columns + drop of old column
    const kinds = descriptorKinds(result);
    expect(kinds.filter((k) => k === 'dataTransform')).toHaveLength(2);
    expect(kinds).toContain('dropColumn');
    // The old column should remain available during the data transform
    // so the user can reference it in the backfill (e.g. split_part(name, ...)).
    // Drops must come AFTER pattern ops for this to work.
    const lastDt = kinds.lastIndexOf('dataTransform');
    const dropIdx = kinds.indexOf('dropColumn');
    expect(dropIdx).toBeGreaterThan(lastDt);
  });

  it('S5: vertical table split — new table starts empty, no auto-detected data migration', () => {
    // The profile table is NEW — zero rows. NOT NULL constraints on empty tables are fine.
    // The real need (INSERT data from user into profile) isn't inferrable from the structural
    // diff — the planner sees "new table + dropped columns" but can't know they're related.
    // This is a `migration new` scenario where the user authors the data migration manually.
    const from = contract({
      user: table({ id: uuidCol(), email: textCol(), bio: textCol({ nullable: true }) }),
    });
    const to = contract({
      user: table({ id: uuidCol(), email: textCol() }),
      profile: table(
        { id: uuidCol(), userId: uuidCol(), bio: textCol({ nullable: true }) },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        },
      ),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Structural ops: drop columns from user, create profile with FK + index
    const summary = descriptorSummary(result);
    expect(summary).toContain('dropColumn.user.bio');
    expect(summary).toContain('createTable.profile');
    expect(summary).toContain('addForeignKey.profile');
  });

  it('S13: nullable → NOT NULL on existing column with potential violations', () => {
    const from = contract({
      user: table({ id: uuidCol(), phone: textCol({ nullable: true }) }),
    });
    const to = contract({
      user: table({ id: uuidCol(), phone: textCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Currently emits just setNotNull — but if table has NULL values, this fails at apply time
    // Should detect this as needing a data migration (user decides what to do with NULLs)
  });

  it('S14: data seeding — new table with NOT NULL FK to new lookup table', () => {
    const from = contract({
      user: table({ id: uuidCol(), countryCode: textCol() }),
    });
    const to = contract({
      country: table({ id: uuidCol(), code: textCol() }),
      user: table(
        { id: uuidCol(), countryId: uuidCol() },
        {
          foreignKeys: [
            {
              columns: ['countryId'],
              references: { table: 'country', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        },
      ),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // countryId is NOT NULL without default on existing user table → data migration
    // Also: country table needs seed data before FK can be applied
  });

  it('S18: multi-tenant — NOT NULL FK column added to multiple existing tables', () => {
    const from = contract({
      user: table({ id: uuidCol(), email: textCol() }),
      order: table({ id: uuidCol(), total: intCol() }),
    });
    const to = contract({
      tenant: table({ id: uuidCol(), name: textCol() }),
      user: table(
        { id: uuidCol(), email: textCol(), tenantId: uuidCol() },
        {
          foreignKeys: [
            {
              columns: ['tenantId'],
              references: { table: 'tenant', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        },
      ),
      order: table(
        { id: uuidCol(), total: intCol(), tenantId: uuidCol() },
        {
          foreignKeys: [
            {
              columns: ['tenantId'],
              references: { table: 'tenant', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        },
      ),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // tenantId on user and order are both NOT NULL without default → 2 data transforms
    const kinds = descriptorKinds(result);
    expect(kinds.filter((k) => k === 'dataTransform')).toHaveLength(2);
  });
});

// ============================================================================
// Mixed / complex
// ============================================================================

describe('mixed / complex', () => {
  it('35: mixed additive + destructive in same plan', () => {
    const from = contract({
      user: table({ id: uuidCol(), email: textCol(), oldField: textCol({ nullable: true }) }),
      legacy: table({ id: uuidCol() }),
    });
    const to = contract({
      user: table({ id: uuidCol(), email: textCol(), newField: textCol({ nullable: true }) }),
      fresh: table({ id: uuidCol(), name: textCol() }),
    });
    const result = plan(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = descriptorKinds(result);
    // Drops
    expect(kinds).toContain('dropColumn');
    expect(kinds).toContain('dropTable');
    // Creates
    expect(kinds).toContain('createTable');
    expect(kinds).toContain('addColumn');
    // Drops should come before creates
    const lastDrop = Math.max(kinds.lastIndexOf('dropColumn'), kinds.lastIndexOf('dropTable'));
    const firstCreate = Math.min(
      kinds.indexOf('createTable') === -1 ? Number.POSITIVE_INFINITY : kinds.indexOf('createTable'),
      kinds.indexOf('addColumn') === -1 ? Number.POSITIVE_INFINITY : kinds.indexOf('addColumn'),
    );
    expect(lastDrop).toBeLessThan(firstCreate);
  });

  it('33: FK references table created in same plan', () => {
    const to = contract({
      author: table({ id: uuidCol(), name: textCol() }),
      book: table(
        { id: uuidCol(), authorId: uuidCol(), title: textCol() },
        {
          foreignKeys: [
            {
              columns: ['authorId'],
              references: { table: 'author', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        },
      ),
    });
    const result = plan(null, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = descriptorSummary(result);
    // Both tables created, FK comes after both
    const authorIdx = summary.indexOf('createTable.author');
    const bookIdx = summary.indexOf('createTable.book');
    const fkIdx = summary.findIndex((s) => s.startsWith('addForeignKey'));
    expect(authorIdx).toBeLessThan(fkIdx);
    expect(bookIdx).toBeLessThan(fkIdx);
  });
});
