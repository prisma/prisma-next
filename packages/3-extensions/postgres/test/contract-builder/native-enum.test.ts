/**
 * TML-2965 (native-enum-ts-authoring, D3): `nativeEnum(...)` + `pg.enum(handle)`
 * author a native Postgres enum column through `defineContract` (TS), byte-
 * shape-matching what the PSL `native_enum` + `pg.enum(Ref)` path produces
 * (see `psl-pg-enum-column.test.ts` in `@prisma-next/target-postgres`):
 *
 *   1. The declared entity lands in `entries.native_enum` and its derived
 *      value-set lands in `entries.valueSet`, keyed by the entity NAME (not
 *      the Postgres type name — they differ when `.map()` is used), in both
 *      the default namespace (`public`) and a named schema (`auth`) — proving
 *      the deferred column descriptor's entity is harvested into `packEntities`
 *      at build time.
 *   2. The column resolves to `{ codecId: 'pg/enum@1', nativeType,
 *      typeParams.typeName, valueSet ref }`, with `nativeType` from the mapped
 *      Postgres type name (schema-qualified for `auth`, bare for `public`) and
 *      `valueSet.entityName` from the entity name — proving qualification
 *      happens at build-stage assembly (D2's `qualifyTypeName`), not at
 *      `pg.enum()` call time, and that name/type-name stay distinct.
 *   3. No CHECK constraint is written (the native type itself enforces
 *      membership).
 *   4. `nativeEnum` rejects an empty or duplicate-valued member list.
 *   5. The emitted `.d.ts` types the column as the member-value literal
 *      union, proven through a real `generateContractDts` emission (not
 *      `typeof contract`).
 */

import { generateContractDts } from '@prisma-next/emitter';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { sqlEmission } from '@prisma-next/sql-contract-emitter';
import { pgEnumDescriptor } from '@prisma-next/target-postgres/codecs';
import type { PostgresSchema } from '@prisma-next/target-postgres/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, field, model, nativeEnum, pg } from '../../src/exports/contract-builder';

const intColumn = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;

function namespace(namespaces: Record<string, unknown>, id: string): PostgresSchema {
  const ns = namespaces[id] as PostgresSchema | undefined;
  if (ns === undefined) {
    throw new Error(`expected namespace "${id}" to be declared`);
  }
  return ns;
}

describe('nativeEnum + pg.enum (TS native-enum authoring)', () => {
  it('name === type name (no .map): keys entries by name, bare column in public', () => {
    // Role has no `.map`, so entity name and Postgres type name are both `Role`.
    const Role = nativeEnum('Role', 'user', 'admin');

    const contract = defineContract({
      models: {
        Account: model('Account', {
          fields: {
            id: field.column(intColumn).id(),
            role: field.column(pg.enum(Role)),
          },
        }).sql({ table: 'accounts' }),
      },
    });

    const ns = namespace(contract.storage.namespaces, 'public');
    expect(ns.entries.native_enum?.['Role']).toEqual(Role.entity);
    expect(ns.valueSet?.['Role']).toEqual({ kind: 'valueSet', values: ['user', 'admin'] });

    const column = ns.table['accounts']?.columns['role'];
    expect(column).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'Role',
      typeParams: { typeName: 'Role' },
      nullable: false,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'Role',
      },
    });
    expect(column?.typeRef).toBeUndefined();
    expect(ns.table['accounts']?.checks ?? []).toEqual([]);
  });

  it('name !== type name (.map): keys entries by name, mapped type name in the column, in public', () => {
    // AalLevel maps to Postgres type `aal_level`: the entries key stays the
    // entity NAME (`AalLevel`), but `nativeType` is the mapped type name.
    const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

    const contract = defineContract({
      models: {
        Session: model('Session', {
          fields: {
            id: field.column(intColumn).id(),
            aal: field.column(pg.enum(AalLevel)).optional(),
          },
        }).sql({ table: 'sessions' }),
      },
    });

    const ns = namespace(contract.storage.namespaces, 'public');
    // Keyed by NAME, not the mapped type name.
    expect(ns.entries.native_enum?.['AalLevel']).toEqual(AalLevel.entity);
    expect(ns.entries.native_enum?.['aal_level']).toBeUndefined();
    expect(ns.valueSet?.['AalLevel']).toEqual({
      kind: 'valueSet',
      values: ['aal1', 'aal2', 'aal3'],
    });

    const column = ns.table['sessions']?.columns['aal'];
    expect(column).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'aal_level',
      typeParams: { typeName: 'aal_level' },
      nullable: true,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'AalLevel',
      },
    });
    expect(column?.typeRef).toBeUndefined();
    expect(ns.table['sessions']?.checks ?? []).toEqual([]);
  });

  it('name !== type name (.map) in a named schema (auth): schema-qualifies the mapped type name, scopes to auth', () => {
    const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

    const contract = defineContract({
      namespaces: ['auth'],
      models: {
        Session: model('Session', {
          namespace: 'auth',
          fields: {
            id: field.column(intColumn).id(),
            aal: field.column(pg.enum(AalLevel)).optional(),
          },
        }).sql({ table: 'sessions' }),
      },
    });

    const ns = namespace(contract.storage.namespaces, 'auth');
    expect(ns.entries.native_enum?.['AalLevel']).toEqual(AalLevel.entity);
    expect(ns.valueSet?.['AalLevel']).toEqual({
      kind: 'valueSet',
      values: ['aal1', 'aal2', 'aal3'],
    });

    const column = ns.table['sessions']?.columns['aal'];
    expect(column).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'auth.aal_level',
      typeParams: { typeName: 'auth.aal_level' },
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'auth',
        entityName: 'AalLevel',
      },
    });
    expect(ns.table['sessions']?.checks ?? []).toEqual([]);

    // The public namespace is untouched — the entity is scoped to `auth` only.
    const publicNs = namespace(contract.storage.namespaces, 'public');
    expect(publicNs.entries.native_enum?.['AalLevel']).toBeUndefined();
  });

  it('rejects an empty member list', () => {
    // The `Members extends readonly [string, ...string[]]` constraint already
    // rejects this at compile time for typed callers; widen the signature to
    // prove the runtime guard also rejects a JS caller with no type checking.
    const untypedNativeEnum = nativeEnum as (name: string, ...members: string[]) => unknown;
    expect(() => untypedNativeEnum('EmptyEnum')).toThrow(/at least one member/);
  });

  it('rejects a duplicate member value', () => {
    expect(() => nativeEnum('DupEnum', 'a', 'b', 'a')).toThrow(/duplicate member value "a"/);
  });

  describe('emitted typing (via generateContractDts, not typeof contract)', () => {
    const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

    const contract = defineContract({
      models: {
        Session: model('Session', {
          fields: {
            id: field.column(intColumn).id(),
            aal: field.column(pg.enum(AalLevel)).optional(),
          },
        }).sql({ table: 'sessions' }),
      },
    });

    const codecLookup: CodecLookup = {
      get: () => undefined,
      targetTypesFor: () => undefined,
      metaFor: () => undefined,
      renderOutputTypeFor: () => undefined,
      renderValueLiteralFor: (id, value) =>
        id === 'pg/enum@1' ? pgEnumDescriptor.renderValueLiteral(value) : undefined,
    };

    function emit(): string {
      return generateContractDts(
        contract,
        sqlEmission,
        [],
        { storageHash: 'test-storage-hash', profileHash: 'test-profile-hash' },
        undefined,
        codecLookup,
      );
    }

    it('types the storage column and field output as the member-value literal union', () => {
      const dts = emit();

      const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
      expect(storageColumnMatch).not.toBeNull();
      expect(storageColumnMatch![0]).toContain("readonly aal: 'aal1' | 'aal2' | 'aal3' | null");

      const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({.+?});/s);
      expect(fieldOutputMatch).not.toBeNull();
      expect(fieldOutputMatch![0]).toContain("readonly aal: 'aal1' | 'aal2' | 'aal3' | null");
    });

    it("nativeEnum's handle preserves name, mapped type name, and the literal member tuple", () => {
      expectTypeOf(AalLevel.name).toEqualTypeOf<'AalLevel'>();
      expectTypeOf(AalLevel.typeName).toEqualTypeOf<'aal_level'>();
      expectTypeOf(AalLevel.members).toEqualTypeOf<readonly ['aal1', 'aal2', 'aal3']>();
    });
  });
});
