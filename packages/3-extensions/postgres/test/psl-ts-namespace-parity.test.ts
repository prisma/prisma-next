import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import { parsePslDocument } from '@prisma-next/psl-parser';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { describe, expect, it } from 'vitest';

const sqlFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const postgresScalarTypeDescriptors = new Map([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
] as const);

const int4Column = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;

/**
 * AC4a parity: PSL `namespace foo { … }` and TS-builder `model(name, {
 * namespace: 'foo' })` must lower the same logical contract to
 * structurally-identical IR (down to `StorageTable.namespaceId` and
 * `SqlStorage.namespaces` membership).
 *
 * Without this parity check, the two authoring surfaces can drift
 * silently (e.g. one path stamps `namespaceId` on the table, the other
 * stops at `model.namespaceId`; or one populates `SqlStorage.namespaces`
 * via the target's factory and the other leaves it on the family
 * default). The shared assertion below is intentionally narrow — it
 * compares the namespace-relevant slices of the IR rather than the
 * whole contract — because adjacent fields (hashes, profile metadata,
 * relations) are exercised by other parity suites and can legitimately
 * differ in spurious ways here.
 */
describe('PSL ↔ TS-builder namespace authoring parity (AC4a)', () => {
  it('two-namespace contract (public + auth) lowers identically through PSL and TS', () => {
    const pslSource = `namespace public {
  model Post {
    id Int @id
  }
}

namespace auth {
  model User {
    id Int @id
  }
}
`;
    const pslResult = interpretPslDocumentToSqlContract({
      document: parsePslDocument({ schema: pslSource, sourceId: 'schema.prisma' }),
      target: postgresTargetPack,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      createNamespace: postgresCreateNamespace,
    });
    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;
    const pslStorage = pslResult.value.storage as SqlStorage;

    const tsContract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      createNamespace: postgresCreateNamespace,
      models: {
        Post: model('Post', {
          namespace: 'public',
          fields: { id: field.column(int4Column).id() },
        }).sql({ table: 'post' }),
        User: model('User', {
          namespace: 'auth',
          fields: { id: field.column(int4Column).id() },
        }).sql({ table: 'user' }),
      },
    });
    const tsStorage = tsContract.storage as SqlStorage;

    // Namespace map: same id-set, same concretion identities at each id.
    expect(Object.keys(pslStorage.namespaces).sort()).toEqual(
      Object.keys(tsStorage.namespaces).sort(),
    );
    for (const id of Object.keys(pslStorage.namespaces)) {
      const fromPsl = pslStorage.namespaces[id];
      const fromTs = tsStorage.namespaces[id];
      // Each call to `postgresCreateNamespace(id)` instantiates a fresh
      // `PostgresSchema` (the factory does not memoize per (id) — and
      // doesn't need to, the instances are frozen and structurally
      // identical for the same id). Compare by structure / class.
      expect(fromPsl?.constructor).toBe(fromTs?.constructor);
      expect(fromPsl).toEqual(fromTs);
    }

    // Nested-by-namespace tables: same `(namespaceId, name)` coordinates.
    const pslCoords = Object.entries(pslStorage.tables)
      .flatMap(([nsId, bucket]) => Object.keys(bucket).map((name) => `${nsId}/${name}`))
      .sort();
    const tsCoords = Object.entries(tsStorage.tables)
      .flatMap(([nsId, bucket]) => Object.keys(bucket).map((name) => `${nsId}/${name}`))
      .sort();
    expect(pslCoords).toEqual(tsCoords);
    expect(pslCoords).toContain('public/post');
    expect(pslCoords).toContain('auth/user');
  });

  it('single-namespace contracts (top-level declarations only) stay byte-stable across surfaces', () => {
    const pslSource = `model Tenant {
  id Int @id
}
`;
    const pslResult = interpretPslDocumentToSqlContract({
      document: parsePslDocument({ schema: pslSource, sourceId: 'schema.prisma' }),
      target: postgresTargetPack,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      createNamespace: postgresCreateNamespace,
    });
    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;
    const pslStorage = pslResult.value.storage as SqlStorage;

    const tsContract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      models: {
        Tenant: model('Tenant', {
          fields: { id: field.column(int4Column).id() },
        }).sql({ table: 'tenant' }),
      },
    });
    const tsStorage = tsContract.storage as SqlStorage;

    // Both surfaces resolve top-level / undeclared-namespace models to
    // the `__unbound__` sentinel and stamp it explicitly on every
    // table, so the on-disk envelope addresses each table with an
    // unambiguous `(namespaceId, name)` pair regardless of surface.
    expect(pslStorage.tables['tenant']?.namespaceId).toBe('__unbound__');
    expect(tsStorage.tables['tenant']?.namespaceId).toBe('__unbound__');

    expect(Object.keys(pslStorage.namespaces)).toEqual(Object.keys(tsStorage.namespaces));
  });
});
