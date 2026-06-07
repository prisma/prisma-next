import type { Contract } from '@prisma-next/contract/types';
import { effectiveControlPolicy } from '@prisma-next/contract/types';
import {
  SqlContractSerializerBase,
  type SqlEntityHydrationFactory,
} from '@prisma-next/family-sql/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  ForeignKey,
  PrimaryKey,
  SqlStorage,
  StorageColumn,
  StorageTable,
  type StorageTypeInstance,
  toStorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import postgresTargetDescriptor from '../src/exports/control';

function makeValidContractJson() {
  return createSqlContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: {} } },
      },
    },
  });
}

function makeContractWithTablesJson() {
  return createSqlContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              post: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      tableName: 'post',
                      columns: ['userId'],
                    },
                    target: {
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      tableName: 'user',
                      columns: ['id'],
                    },
                    constraint: true,
                    index: true,
                  },
                ],
              },
            },
          },
        },
      },
    },
  });
}

describe('PostgresContractSerializer', () => {
  it('extends SqlContractSerializerBase', () => {
    const serializer = new PostgresContractSerializer();
    expect(serializer).toBeInstanceOf(SqlContractSerializerBase);
  });

  it('deserializes a valid SQL contract envelope', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());
    expect(contract.targetFamily).toBe('sql');
    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries.table).toEqual({});
  });

  it('hydrates JSON storage into the SQL Contract IR class hierarchy', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());

    expect(contract.storage).toBeInstanceOf(SqlStorage);
    const tables = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries.table;
    const userTable = tables['user'] as StorageTable | undefined;
    expect(userTable).toBeInstanceOf(StorageTable);
    expect(userTable?.columns['id']).toBeInstanceOf(StorageColumn);
    expect(userTable?.primaryKey).toBeInstanceOf(PrimaryKey);
    const postTable = tables['post'] as StorageTable | undefined;
    expect(postTable).toBeInstanceOf(StorageTable);
    expect(postTable?.foreignKeys[0]).toBeInstanceOf(ForeignKey);
  });

  it('rejects an invalid contract (family-shared structural validation runs)', () => {
    const serializer = new PostgresContractSerializer();
    const bad = { ...makeValidContractJson(), targetFamily: 'mongo' };
    expect(() => serializer.deserializeContract(bad)).toThrow();
  });

  it('serializeContract round-trips a JSON-clean contract', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));
    expect(reparsed).toMatchObject({
      targetFamily: 'sql',
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            kind: 'postgres-unbound-schema',
            entries: {
              table: {
                user: {
                  columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
                },
              },
              type: {},
            },
          },
        },
      },
    });
    expect(reparsed.storage).not.toHaveProperty('kind');
    expect(reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.table.user).not.toHaveProperty(
      'kind',
    );
    expect(
      reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.table.user.columns.id,
    ).not.toHaveProperty('kind');
  });

  it('hydrates storage.types entries via the family registry dispatch path', () => {
    const sentinel: StorageTypeInstance = toStorageTypeInstance({
      codecId: 'test/fake-test-entity@1',
      nativeType: 'fake-test-entity',
      typeParams: { proof: true },
    });

    const registry = new Map<string, SqlEntityHydrationFactory>([
      ['fake-test-entity', () => sentinel],
    ]);

    class RegistryDispatchProbeSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
      constructor() {
        super(registry);
      }

      protected override parseSqlContractStructure(_json: unknown): Contract<SqlStorage> {
        const base = createSqlContract({
          storage: {
            namespaces: {
              [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: {} } },
            },
          },
        }) as unknown as Contract<SqlStorage>;
        return {
          ...base,
          storage: {
            ...base.storage,
            types: {
              fake_thing: { kind: 'fake-test-entity' as const },
            },
          },
        } as unknown as Contract<SqlStorage>;
      }
    }

    const contract = new RegistryDispatchProbeSerializer().deserializeContract({});
    expect(contract.storage.types?.['fake_thing']).toBe(sentinel);
  });
});

describe('control-policy round-trip fidelity', () => {
  function makeMixedControlContractJson() {
    const base = createSqlContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    id: {
                      nativeType: 'int4',
                      codecId: 'pg/int4@1',
                      nullable: false,
                      control: 'observed',
                    },
                    email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                  control: 'external',
                },
              },
            },
          },
        },
      },
    });
    return {
      ...base,
      defaultControlPolicy: 'tolerated',
      storage: {
        ...base.storage,
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            ...base.storage.namespaces[UNBOUND_NAMESPACE_ID]!,
            entries: {
              ...base.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries,
              type: {
                Role: {
                  kind: 'postgres-enum',
                  name: 'Role',
                  nativeType: 'role',
                  values: ['admin', 'user'],
                  control: 'managed',
                },
              },
            },
          },
        },
      },
    };
  }

  it('preserves effective control per node across serialize → deserialize', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeMixedControlContractJson();

    const contract = serializer.deserializeContract(input);
    const reparsed = JSON.parse(JSON.stringify(serializer.serializeContract(contract)));

    expect(reparsed.defaultControlPolicy).toBe('tolerated');

    const ns = reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID];
    const table = ns.entries.table.user;
    const idColumn = table.columns.id;
    const emailColumn = table.columns.email;
    const enumEntry = ns.entries.type.Role;

    const def = reparsed.defaultControlPolicy;
    expect(effectiveControlPolicy(table.control, def)).toBe('external');
    expect(effectiveControlPolicy(idColumn.control, def)).toBe('observed');
    expect(effectiveControlPolicy(emailColumn.control, def)).toBe('tolerated');
    expect(effectiveControlPolicy(enumEntry.control, def)).toBe('managed');

    // Omit-when-default holds: the unset column never grows a control property.
    expect(emailColumn).not.toHaveProperty('control');
  });
});

describe('postgresTargetDescriptor', () => {
  it('exposes a contractSerializer property', () => {
    expect(postgresTargetDescriptor.contractSerializer).toBeInstanceOf(PostgresContractSerializer);
  });

  it('exposes a schemaVerifier property next to migrations', () => {
    expect(postgresTargetDescriptor.schemaVerifier).toBeDefined();
    expect(postgresTargetDescriptor.migrations).toBeDefined();
  });
});
