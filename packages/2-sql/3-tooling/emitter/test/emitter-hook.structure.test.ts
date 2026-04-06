import type { Contract } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';

function createContract(overrides: Partial<Contract>): Contract {
  return {
    targetFamily: 'sql',
    target: 'test-db',
    models: {},
    roots: {},
    storage: { tables: {} },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    profileHash: 'sha256:test',
    ...overrides,
  };
}

describe('sql-target-family-hook', () => {
  it('validates SQL structure', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'sql/int@1', nullable: false },
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
      sqlEmission.validateStructure(ir);
    }).not.toThrow();
  });

  it('throws error for invalid structure', () => {
    const ir = createContract({
      models: {
        User: {
          storage: { table: 'nonexistent', fields: {} },
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
      sqlEmission.validateStructure(ir);
    }).toThrow();
  });

  it('validates structure with model field missing column property', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: {},
            },
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
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing column property');
  });

  it('validates structure with missing targetFamily', () => {
    const ir = {
      ...createContract({}),
      targetFamily: undefined as unknown as string,
    } as Contract;

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('Expected targetFamily "sql"');
  });

  it('validates structure with missing storage', () => {
    const ir = createContract({
      storage: undefined as unknown as Record<string, unknown>,
    }) as Contract;

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('SQL contract must have storage.tables');
  });

  it('validates structure with missing storage.tables', () => {
    const ir = createContract({
      storage: {},
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('SQL contract must have storage.tables');
  });

  it('validates structure with model missing storage.table', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing storage.table');
  });

  it('validates structure with model referencing non-existent table', () => {
    const ir = createContract({
      models: {
        User: {
          storage: { table: 'nonexistent', fields: {} },
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
      sqlEmission.validateStructure(ir);
    }).toThrow('references non-existent table');
  });

  it('validates structure with model table missing primary key', () => {
    const ir = createContract({
      models: {
        User: {
          storage: { table: 'user', fields: {} },
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
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing a primary key');
  });

  it('validates structure with model field referencing non-existent column', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: { id: { column: 'nonexistent' } },
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
      sqlEmission.validateStructure(ir);
    }).toThrow('references non-existent column');
  });

  it('validates structure with missing model storage.fields', () => {
    const ir = createContract({
      models: {
        User: {
          storage: { table: 'user' },
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
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing storage.fields');
  });

  it('validates structure with primaryKey referencing non-existent column', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('primaryKey references non-existent column');
  });

  it('validates structure with unique constraint referencing non-existent column', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('unique constraint references non-existent column');
  });

  it('validates structure with index referencing non-existent column', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('index references non-existent column');
  });

  it('validates structure with foreignKey referencing non-existent column', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('foreignKey references non-existent column');
  });

  it('validates structure with foreignKey referencing non-existent table', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('foreignKey references non-existent table');
  });

  it('validates structure with foreignKey referencing non-existent referenced column', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('foreignKey references non-existent column');
  });

  it('validates structure with foreignKey column count mismatch', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('column count');
  });

  it('validates structure with model missing relations', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
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
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing required field "relations"');
  });

  it('validates structure with model relations not an object', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
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
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing required field "relations"');
  });

  it('validates structure with uniques not an array', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing required field "uniques"');
  });

  it('validates structure with indexes not an array', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing required field "indexes"');
  });

  it('validates structure with foreignKeys not an array', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing required field "foreignKeys"');
  });

  it('validates structure with table missing from storage.tables after check', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
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
      sqlEmission.validateStructure(ir);
    }).toThrow('references non-existent table');
  });

  it('validates structure with referenced table missing from storage.tables after check', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).toThrow('references non-existent table');
  });

  it('validates structure without models', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).not.toThrow();
  });

  it('validates structure with table without primary key when no models', () => {
    const ir = createContract({
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
      sqlEmission.validateStructure(ir);
    }).not.toThrow();
  });

  it('accepts extension-owned index config payloads without core-specific validation', () => {
    const ir = createContract({
      storage: {
        tables: {
          items: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              description: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [
              {
                columns: ['description'],
                using: 'bm25',
                config: {
                  keyField: 'id',
                  fields: [{ column: 'description', tokenizer: 'simple' }],
                },
              },
            ],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).not.toThrow();
  });

  it('still validates index column references independent of extension config', () => {
    const ir = createContract({
      storage: {
        tables: {
          items: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              description: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [
              {
                columns: ['nonexistent'],
                using: 'bm25',
                config: {
                  keyField: 'id',
                  fields: [{ expression: "description || ' ' || category", tokenizer: 'simple' }],
                },
              },
            ],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('index references non-existent column');
  });

  it('validates structure with complex valid contract', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
              email: { column: 'email' },
            },
          },
          relations: {},
        },
        Post: {
          storage: {
            table: 'post',
            fields: {
              id: { column: 'id' },
              userId: { column: 'userId' },
              title: { column: 'title' },
            },
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
      sqlEmission.validateStructure(ir);
    }).not.toThrow();
  });
});
