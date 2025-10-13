import { describe, it, expect } from 'vitest';
import {
  validateContract,
  validateTable,
  validateColumn,
  ColumnTypeSchema,
  DefaultValueSchema,
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
});
