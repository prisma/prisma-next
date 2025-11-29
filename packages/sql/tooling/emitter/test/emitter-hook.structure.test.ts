import type { ContractIR } from '@prisma-next/contract/ir';
import { describe, expect, it } from 'vitest';
import { sqlTargetFamilyHook } from '../src/index';

function createContractIR(overrides: Partial<ContractIR>): ContractIR {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'test-db',
    models: {},
    relations: {},
    storage: { tables: {} },
    extensions: {},
    capabilities: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}

describe('sql-target-family-hook', () => {
  it('validates SQL structure', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'sql/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).not.toThrow();
  });

  it('throws error for invalid structure', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'nonexistent' },
          fields: {},
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow();
  });

  it('validates structure with model field missing column property', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: {},
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing column property');
  });

  it('validates structure with missing targetFamily', () => {
    const ir = {
      ...createContractIR({}),
      targetFamily: undefined as unknown as string,
    } as ContractIR;

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('Expected targetFamily "sql"');
  });

  it('validates structure with missing storage', () => {
    const ir = createContractIR({
      storage: undefined as unknown as Record<string, unknown>,
    }) as ContractIR;

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('SQL contract must have storage.tables');
  });

  it('validates structure with missing storage.tables', () => {
    const ir = createContractIR({
      storage: {},
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('SQL contract must have storage.tables');
  });

  it('validates structure with model missing storage.table', () => {
    const ir = createContractIR({
      models: {
        User: {
          fields: {},
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing storage.table');
  });

  it('validates structure with model referencing non-existent table', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'nonexistent' },
          fields: {},
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('references non-existent table');
  });

  it('validates structure with model table missing primary key', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {},
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing a primary key');
  });

  it('validates structure with model field referencing non-existent column', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'nonexistent' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('references non-existent column');
  });

  it('validates structure with missing model fields', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {},
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing fields');
  });

  it('validates structure with primaryKey referencing non-existent column', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['nonexistent'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('primaryKey references non-existent column');
  });

  it('validates structure with unique constraint referencing non-existent column', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['nonexistent'] }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('unique constraint references non-existent column');
  });

  it('validates structure with index referencing non-existent column', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ columns: ['nonexistent'] }],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('index references non-existent column');
  });

  it('validates structure with foreignKey referencing non-existent column', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
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
                columns: ['nonexistent'],
                references: { table: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('foreignKey references non-existent column');
  });

  it('validates structure with foreignKey referencing non-existent table', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
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
                columns: ['userId'],
                references: { table: 'nonexistent', columns: ['id'] },
              },
            ],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('foreignKey references non-existent table');
  });

  it('validates structure with foreignKey referencing non-existent referenced column', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
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
                columns: ['userId'],
                references: { table: 'user', columns: ['nonexistent'] },
              },
            ],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('foreignKey references non-existent column');
  });

  it('validates structure with foreignKey column count mismatch', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
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
                columns: ['userId'],
                references: { table: 'user', columns: ['id', 'id'] },
              },
            ],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('column count');
  });

  it('validates structure with model missing relations', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
          relations: undefined as unknown,
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing required field "relations"');
  });

  it('validates structure with model relations not an object', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
          relations: 'invalid' as unknown,
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing required field "relations"');
  });

  it('validates structure with column missing nullable field', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1' } as {
                nativeType: string;
                codecId: string;
                nullable?: unknown;
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing required field "nullable"');
  });

  it('validates structure with column nullable not a boolean', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: 'invalid' as unknown as boolean,
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing required field "nullable"');
  });

  it('validates structure with uniques not an array', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: 'invalid' as unknown,
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing required field "uniques"');
  });

  it('validates structure with indexes not an array', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: 'invalid' as unknown,
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing required field "indexes"');
  });

  it('validates structure with foreignKeys not an array', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: 'invalid' as unknown,
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing required field "foreignKeys"');
  });

  it('validates structure with table missing from storage.tables after check', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    // Create a proxy to intercept table access and simulate the table being deleted
    // This tests the path where tableNames.has(tableName) is true but storage.tables[tableName] is undefined
    const originalStorage = ir.storage as { tables: Record<string, unknown> };
    let tableDeleted = false;
    const proxiedStorage = new Proxy(originalStorage, {
      get(target, prop) {
        if (prop === 'tables') {
          const tables = new Proxy(target.tables, {
            get(tableTarget, tableProp) {
              if (tableProp === 'user' && tableDeleted) {
                return undefined;
              }
              return tableTarget[tableProp as string];
            },
            has(tableTarget, tableProp) {
              return tableProp in tableTarget;
            },
            ownKeys(tableTarget) {
              return Object.keys(tableTarget);
            },
          });
          return tables;
        }
        return target[prop as keyof typeof target];
      },
    });

    // Delete the table after creating the proxy
    delete originalStorage.tables['user'];
    tableDeleted = true;

    // Replace storage with proxied version
    (ir as { storage: unknown }).storage = proxiedStorage;

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('references non-existent table');
  });

  it('validates structure with referenced table missing from storage.tables after check', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
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
                columns: ['userId'],
                references: { table: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    });

    // Create a proxy to intercept table access and simulate the table being deleted
    // This tests the path where tableNames.has(tableName) is true but storage.tables[tableName] is undefined
    const originalStorage = ir.storage as { tables: Record<string, unknown> };
    let tableDeleted = false;
    const proxiedStorage = new Proxy(originalStorage, {
      get(target, prop) {
        if (prop === 'tables') {
          const tables = new Proxy(target.tables, {
            get(tableTarget, tableProp) {
              if (tableProp === 'user' && tableDeleted) {
                return undefined;
              }
              return tableTarget[tableProp as string];
            },
            has(tableTarget, tableProp) {
              return tableProp in tableTarget;
            },
            ownKeys(tableTarget) {
              return Object.keys(tableTarget);
            },
          });
          return tables;
        }
        return target[prop as keyof typeof target];
      },
    });

    // Delete the table after creating the proxy
    delete originalStorage.tables['user'];
    tableDeleted = true;

    // Replace storage with proxied version
    (ir as { storage: unknown }).storage = proxiedStorage;

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('references non-existent table');
  });

  it('validates structure without models', () => {
    const ir = createContractIR({
      models: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).not.toThrow();
  });

  it('validates structure with table without primary key when no models', () => {
    const ir = createContractIR({
      models: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).not.toThrow();
  });

  it('validates structure with complex valid contract', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
          },
          relations: {},
        },
        Post: {
          storage: { table: 'post' },
          fields: {
            id: { column: 'id' },
            userId: { column: 'userId' },
            title: { column: 'title' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'] }],
            indexes: [{ columns: ['email'] }],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ columns: ['userId'] }],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    });

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).not.toThrow();
  });
});
