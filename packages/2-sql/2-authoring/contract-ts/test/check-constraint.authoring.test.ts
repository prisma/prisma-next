import type { Contract } from '@prisma-next/contract/types';
import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import {
  CheckConstraint,
  type SqlStorage,
  StorageTable,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { defineContract } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: { codecId: 'pg/text@1', nativeType: 'text' },
      },
    },
  },
} as const satisfies FamilyPackRef<'sql'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;

// ---------------------------------------------------------------------------
// Lowering: check constraints emitted per enum-restricted column
// ---------------------------------------------------------------------------

describe('check-constraint lowering', () => {
  it('emits a check constraint for each enum-restricted column', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: {
                id: f.text().id(),
                role: f.namedType(Role),
              },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const userTable = storageNs !== undefined ? storageNs.entries.table?.['User'] : undefined;

    expect(userTable?.checks).toHaveLength(1);
    expect(userTable?.checks?.[0]).toMatchObject({
      name: 'User_role_check',
      column: 'role',
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'Role',
      },
    });
  });

  it('emits one check per enum-restricted column when multiple columns are restricted', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
    const Status = enumType(
      'Status',
      pgText,
      member('Active', 'active'),
      member('Inactive', 'inactive'),
    );

    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role, Status },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: {
                id: f.text().id(),
                role: f.namedType(Role),
                status: f.namedType(Status),
              },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const userTable = storageNs !== undefined ? storageNs.entries.table?.['User'] : undefined;

    expect(userTable?.checks).toHaveLength(2);
    const checkNames = userTable?.checks?.map((c) => c.name).sort();
    expect(checkNames).toEqual(['User_role_check', 'User_status_check']);
  });

  it('leaves checks absent when no enum-restricted columns exist', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: {
                id: f.text().id(),
                name: f.text(),
              },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const userTable = storageNs !== undefined ? storageNs.entries.table?.['User'] : undefined;

    expect(userTable?.checks).toBeUndefined();
  });

  it('check constraint items are CheckConstraint instances', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: {
                id: f.text().id(),
                role: f.namedType(Role),
              },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const userTable = storageNs !== undefined ? storageNs.entries.table?.['User'] : undefined;

    expect(userTable?.checks?.[0]).toHaveProperty('valueSet');
  });
});

// ---------------------------------------------------------------------------
// CHECK suppression: codec-owned `enforcesValueSet` marker
// ---------------------------------------------------------------------------

function stubCodecWithDescriptor(id: string, descriptor: unknown): Codec {
  const codec = {
    id,
    descriptor,
    encode: () => Promise.reject(new Error('unused')),
    decode: () => Promise.reject(new Error('unused')),
    encodeJson: (value: unknown) => value,
    decodeJson: (json: unknown) => json,
  };
  return codec as Codec;
}

describe('check-constraint suppression via codec-owned enforcesValueSet marker', () => {
  it('writes no CHECK for a value-set column whose codec enforces its value-set', () => {
    const nativeEnumCodecId = 'test/native-enum@1';
    const codec = stubCodecWithDescriptor(nativeEnumCodecId, {
      codecId: nativeEnumCodecId,
      enforcesValueSet: true,
    });
    const codecLookup: CodecLookup = {
      get: (id) => (id === nativeEnumCodecId ? codec : undefined),
      targetTypesFor: () => undefined,
      metaFor: () => undefined,
      renderOutputTypeFor: () => undefined,
    };

    const NativeRole = enumType(
      'NativeRole',
      { codecId: nativeEnumCodecId, nativeType: 'native_role' },
      member('User', 'user'),
      member('Admin', 'admin'),
    );

    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { NativeRole },
        codecLookup,
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: {
                id: f.text().id(),
                role: f.namedType(NativeRole),
              },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const userTable = storageNs !== undefined ? storageNs.entries.table?.['User'] : undefined;

    expect(userTable?.checks).toBeUndefined();
  });

  it('still writes a CHECK when the codec has no enforcesValueSet marker (unaffected path)', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
    const codecLookup: CodecLookup = {
      get: (id) => (id === 'pg/text@1' ? stubCodecWithDescriptor('pg/text@1', {}) : undefined),
      targetTypesFor: () => undefined,
      metaFor: () => undefined,
      renderOutputTypeFor: () => undefined,
    };

    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
        codecLookup,
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: {
                id: f.text().id(),
                role: f.namedType(Role),
              },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const userTable = storageNs !== undefined ? storageNs.entries.table?.['User'] : undefined;

    expect(userTable?.checks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Serialize → deserialize round-trip
// ---------------------------------------------------------------------------

describe('check-constraint serialize→hydrate round-trip', () => {
  it('preserves checks through JSON round-trip', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: {
                id: f.text().id(),
                role: f.namedType(Role),
              },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    // Serialize to JSON and back
    const json = JSON.parse(JSON.stringify(contract)) as {
      storage: {
        namespaces: Record<string, { entries: { table: Record<string, unknown> } }>;
      };
    };

    // Re-hydrate via StorageTable constructor (simulating deserialization)
    const rawTable = json.storage.namespaces['public']?.entries.table['User'];
    const hydratedTable = new StorageTable(rawTable as StorageTableInput);

    expect(hydratedTable.checks).toHaveLength(1);
    expect(hydratedTable.checks![0]).toBeInstanceOf(CheckConstraint);
    expect(hydratedTable.checks![0]!.name).toBe('User_role_check');
    expect(hydratedTable.checks![0]!.column).toBe('role');
    expect(hydratedTable.checks![0]!.valueSet).toEqual({
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId: 'public',
      entityName: 'Role',
    });
  });
});
