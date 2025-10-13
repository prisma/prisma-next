import { describe, it, expect } from 'vitest';
import {
  validateContract,
  validateTable,
  validateColumn,
  validateModelMappings,
  ColumnTypeSchema,
  DefaultValueSchema,
  ModelFieldSchema,
  ModelStorageSchema,
  ModelSchema,
} from '../src/schema';

describe('Schema Validation', () => {
  it('validates a complete schema with new IR structure', () => {
    const schema = {
      target: 'postgres',
      tables: {
        user: {
          columns: {
            id: {
              type: 'int4',
              nullable: false,
              pk: true,
              default: { kind: 'autoincrement' },
            },
            email: {
              type: 'text',
              nullable: false,
              unique: true,
            },
            active: {
              type: 'bool',
              nullable: false,
              default: { kind: 'literal', value: 'true' },
            },
            createdAt: {
              type: 'timestamptz',
              nullable: false,
              default: { kind: 'now' },
            },
          },
          indexes: [],
          constraints: [],
          capabilities: [],
          meta: {
            source: 'model User',
          },
        },
      },
    };

    expect(() => validateContract(schema)).not.toThrow();
  });

  it('validates a table', () => {
    const table = {
      columns: {
        id: {
          type: 'int4',
          nullable: false,
          pk: true,
        },
        email: {
          type: 'text',
          nullable: false,
          unique: true,
        },
      },
      indexes: [],
      constraints: [],
      capabilities: [],
    };

    expect(() => validateTable(table)).not.toThrow();
  });

  it('validates a column', () => {
    const column = {
      type: 'text',
      nullable: false,
      unique: true,
    };

    expect(() => validateColumn(column)).not.toThrow();
  });

  it('validates PostgreSQL column types', () => {
    const validTypes = [
      'int4',
      'int8',
      'text',
      'varchar',
      'bool',
      'timestamptz',
      'timestamp',
      'float8',
      'float4',
      'uuid',
      'json',
      'jsonb',
    ];

    validTypes.forEach((type) => {
      expect(() => ColumnTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('validates default value kinds', () => {
    const autoincrement = { kind: 'autoincrement' };
    const now = { kind: 'now' };
    const literal = { kind: 'literal', value: 'test' };

    expect(() => DefaultValueSchema.parse(autoincrement)).not.toThrow();
    expect(() => DefaultValueSchema.parse(now)).not.toThrow();
    expect(() => DefaultValueSchema.parse(literal)).not.toThrow();
  });

  it('rejects invalid schema without target', () => {
    const invalidSchema = {
      tables: {
        user: {
          columns: {
            id: { type: 'int4', nullable: false },
          },
          indexes: [],
          constraints: [],
          capabilities: [],
        },
      },
    };

    expect(() => validateContract(invalidSchema)).toThrow();
  });

  it('rejects invalid target', () => {
    const invalidSchema = {
      target: 'mysql',
      tables: {},
    };

    expect(() => validateContract(invalidSchema)).toThrow();
  });

  it('rejects invalid column type', () => {
    const invalidColumn = {
      type: 'invalid_type',
      nullable: false,
    };

    expect(() => validateColumn(invalidColumn)).toThrow();
  });

  describe('Model Schema Validation', () => {
    it('validates a complete schema with models', () => {
      const schema = {
        target: 'postgres',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              email: { type: 'text', nullable: false, unique: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [{ kind: 'unique', columns: ['email'] }],
            foreignKeys: [],
            indexes: [],
            capabilities: [],
          },
        },
        models: {
          User: {
            name: 'User',
            storage: { kind: 'table', target: 'user' },
            fields: {
              id: { type: 'Int', mappedTo: 'id' },
              email: { type: 'String', mappedTo: 'email' },
              posts: { type: 'Post', isList: true, isRelation: true, relationTarget: 'Post' },
            },
            meta: { source: 'model User' },
          },
        },
      };

      expect(() => validateContract(schema)).not.toThrow();
    });

    it('validates model field schema', () => {
      const scalarField = {
        type: 'String',
        isOptional: true,
        mappedTo: 'email',
      };

      const relationField = {
        type: 'Post',
        isList: true,
        isRelation: true,
        relationTarget: 'Post',
      };

      expect(() => ModelFieldSchema.parse(scalarField)).not.toThrow();
      expect(() => ModelFieldSchema.parse(relationField)).not.toThrow();
    });

    it('validates model storage schema', () => {
      const tableStorage = { kind: 'table', target: 'users' };
      const viewStorage = { kind: 'view', target: 'user_view' };
      const collectionStorage = { kind: 'collection', target: 'users' };

      expect(() => ModelStorageSchema.parse(tableStorage)).not.toThrow();
      expect(() => ModelStorageSchema.parse(viewStorage)).not.toThrow();
      expect(() => ModelStorageSchema.parse(collectionStorage)).not.toThrow();
    });

    it('validates model schema', () => {
      const model = {
        name: 'User',
        storage: { kind: 'table', target: 'user' },
        fields: {
          id: { type: 'Int', mappedTo: 'id' },
          email: { type: 'String', mappedTo: 'email' },
        },
        meta: { source: 'model User' },
      };

      expect(() => ModelSchema.parse(model)).not.toThrow();
    });

    it('validates model mappings against tables', () => {
      const schema = {
        target: 'postgres' as const,
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false },
              email: { type: 'text', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
            capabilities: [],
          },
        },
        models: {
          User: {
            name: 'User',
            storage: { kind: 'table', target: 'user' },
            fields: {
              id: { type: 'Int', mappedTo: 'id' },
              email: { type: 'String', mappedTo: 'email' },
            },
          },
        },
      };

      expect(() => validateModelMappings(schema)).not.toThrow();
    });

    it('throws error for model referencing non-existent table', () => {
      const schema = {
        target: 'postgres' as const,
        tables: {
          user: {
            columns: { id: { type: 'int4', nullable: false } },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
            capabilities: [],
          },
        },
        models: {
          User: {
            name: 'User',
            storage: { kind: 'table', target: 'nonexistent' },
            fields: {
              id: { type: 'Int', mappedTo: 'id' },
            },
          },
        },
      };

      expect(() => validateModelMappings(schema)).toThrow(
        "Model 'User' references non-existent table 'nonexistent'",
      );
    });

    it('throws error for field mapping to non-existent column', () => {
      const schema = {
        target: 'postgres' as const,
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
            capabilities: [],
          },
        },
        models: {
          User: {
            name: 'User',
            storage: { kind: 'table', target: 'user' },
            fields: {
              id: { type: 'Int', mappedTo: 'id' },
              email: { type: 'String', mappedTo: 'nonexistent' },
            },
          },
        },
      };

      expect(() => validateModelMappings(schema)).toThrow(
        "Model 'User' field 'email' maps to non-existent column 'nonexistent' in table 'user'",
      );
    });

    it('skips validation for relation fields', () => {
      const schema = {
        target: 'postgres' as const,
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
            capabilities: [],
          },
        },
        models: {
          User: {
            name: 'User',
            storage: { kind: 'table', target: 'user' },
            fields: {
              id: { type: 'Int', mappedTo: 'id' },
              posts: { type: 'Post', isRelation: true, relationTarget: 'Post' },
            },
          },
        },
      };

      expect(() => validateModelMappings(schema)).not.toThrow();
    });

    it('handles schema without models', () => {
      const schema = {
        target: 'postgres' as const,
        tables: {
          user: {
            columns: { id: { type: 'int4', nullable: false } },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
            capabilities: [],
          },
        },
      };

      expect(() => validateModelMappings(schema)).not.toThrow();
    });
  });
});
