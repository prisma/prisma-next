import { describe, it, expect } from 'vitest';
import { emitContractTypes } from '../src/contract-types-emitter';
import { Schema, Table, Column } from '@prisma/relational-ir';

describe('emitContractTypes', () => {
  const mockSchema: Schema = {
    target: 'postgres',
    tables: {
      user: {
        columns: {
          id: {
            type: 'int4',
            pk: true,
            nullable: false,
          },
          email: {
            type: 'text',
            unique: true,
            nullable: false,
          },
          active: { type: 'bool', default: { kind: 'literal', value: 'true' }, nullable: false },
          createdAt: { type: 'timestamptz', default: { kind: 'now' }, nullable: false },
        },
        primaryKey: { kind: 'primaryKey', columns: ['id'] },
        uniques: [{ kind: 'unique', columns: ['email'] }],
        foreignKeys: [],
        indexes: [],
        capabilities: [],
        meta: { source: 'model User' },
      },
      post: {
        columns: {
          id: {
            type: 'int4',
            pk: true,
            nullable: false,
          },
          title: {
            type: 'text',
            nullable: false,
          },
          published: {
            type: 'bool',
            default: { kind: 'literal', value: 'false' },
            nullable: false,
          },
          createdAt: { type: 'timestamptz', default: { kind: 'now' }, nullable: false },
          user_id: {
            type: 'int4',
            nullable: false,
          },
        },
        primaryKey: { kind: 'primaryKey', columns: ['id'] },
        uniques: [],
        foreignKeys: [
          {
            kind: 'foreignKey',
            columns: ['user_id'],
            references: { table: 'user', columns: ['id'] },
            name: 'post_user_id_fkey',
          },
        ],
        indexes: [],
        capabilities: [],
        meta: { source: 'model Post' },
      },
    },
  };

  it('generates correct TypeScript definitions with default namespace', () => {
    const result = emitContractTypes(mockSchema);

    expect(result).toContain('export namespace Contract {');
    expect(result).toContain('export interface UserShape {');
    expect(result).toContain('export interface PostShape {');
    expect(result).toContain('export type Tables = {');
    expect(result).toContain('export type Relations = {');
    expect(result).toContain('export type Uniques = {');
  });

  it('generates correct TypeScript definitions with custom namespace', () => {
    const result = emitContractTypes(mockSchema, 'MySchema');

    expect(result).toContain('export namespace MySchema {');
    expect(result).not.toContain('export namespace Contract {');
  });

  it('generates correct column types', () => {
    const result = emitContractTypes(mockSchema);

    // Check UserShape
    expect(result).toContain('id: number;');
    expect(result).toContain('email: string;');
    expect(result).toContain('active: boolean;');
    expect(result).toContain('createdAt: Date;');

    // Check PostShape
    expect(result).toContain('title: string;');
    expect(result).toContain('published: boolean;');
    expect(result).toContain('user_id: number;');
  });

  it('generates correct Tables interface', () => {
    const result = emitContractTypes(mockSchema);

    expect(result).toContain('user: Table<UserShape>;');
    expect(result).toContain('post: Table<PostShape>;');
  });

  it('generates correct Relations type', () => {
    const result = emitContractTypes(mockSchema);

    // Should contain relation definitions
    expect(result).toContain('post: {');
    expect(result).toContain('user: {');
    expect(result).toContain("to: 'user';");
    expect(result).toContain("to: 'post';");
    expect(result).toContain("cardinality: '1:N';");
    expect(result).toContain("cardinality: 'N:1';");
  });

  it('generates correct Uniques type', () => {
    const result = emitContractTypes(mockSchema);

    expect(result).toContain("user:       ['id'] |       ['email'];");
    expect(result).toContain("post:       ['id'];");
  });

  it('includes proper imports', () => {
    const result = emitContractTypes(mockSchema);

    expect(result).toContain("import { Column, Table } from '@prisma/sql';");
  });

  it('includes file header comments', () => {
    const result = emitContractTypes(mockSchema);

    expect(result).toContain('// Generated TypeScript definitions');
    expect(result).toContain('// This file is auto-generated. Do not edit manually.');
  });

  it('handles empty schema', () => {
    const emptySchema: Schema = {
      target: 'postgres',
      tables: {},
    };

    const result = emitContractTypes(emptySchema);

    expect(result).toContain('export namespace Contract {');
    expect(result).toContain('export type Tables = {');
    expect(result).not.toContain('export interface UserShape');
    expect(result).not.toContain('export interface PostShape');
  });

  it('handles schema with no uniques', () => {
    const schemaWithoutUniques: Schema = {
      target: 'postgres',
      tables: {
        user: {
          columns: {
            name: {
              type: 'text',
              nullable: false,
            },
            age: {
              type: 'int4',
              nullable: false,
            },
          },
          primaryKey: undefined,
          uniques: [],
          foreignKeys: [],
          indexes: [],
          capabilities: [],
          meta: { source: 'model User' },
        },
      },
    };

    const result = emitContractTypes(schemaWithoutUniques);

    expect(result).toContain('export namespace Contract {');
    expect(result).toContain('export interface UserShape {');
    expect(result).toContain('export type Tables = {');
    // Should not contain Relations or Uniques if empty
    expect(result).not.toContain('export type Relations = {');
    expect(result).not.toContain('export type Uniques = {');
  });

  it('handles schema with no relations', () => {
    const schemaWithoutRelations: Schema = {
      target: 'postgres',
      tables: {
        user: {
          columns: {
            id: {
              type: 'int4',
              pk: true,
              nullable: false,
            },
            name: {
              type: 'text',
              nullable: false,
            },
          },
          primaryKey: { kind: 'primaryKey', columns: ['id'] },
          uniques: [],
          foreignKeys: [],
          indexes: [],
          capabilities: [],
          meta: { source: 'model User' },
        },
      },
    };

    const result = emitContractTypes(schemaWithoutRelations);

    expect(result).toContain('export namespace Contract {');
    expect(result).toContain('export interface UserShape {');
    expect(result).toContain('export type Tables = {');
    // Should not contain Relations if empty, but Uniques will contain primary key
    expect(result).not.toContain('export type Relations = {');
    expect(result).toContain('export type Uniques = {');
    expect(result).toContain("user:       ['id'];");
  });

  it('maps PostgreSQL types to TypeScript correctly', () => {
    const schemaWithVariousTypes: Schema = {
      target: 'postgres',
      tables: {
        test: {
          columns: {
            int4_col: {
              type: 'int4',
              nullable: false,
            },
            int8_col: {
              type: 'int8',
              nullable: false,
            },
            float4_col: {
              type: 'float4',
              nullable: false,
            },
            float8_col: {
              type: 'float8',
              nullable: false,
            },
            text_col: {
              type: 'text',
              nullable: false,
            },
            varchar_col: {
              type: 'varchar',
              nullable: false,
            },
            uuid_col: {
              type: 'uuid',
              nullable: false,
            },
            bool_col: {
              type: 'bool',
              nullable: false,
            },
            timestamptz_col: {
              type: 'timestamptz',
              nullable: false,
            },
            timestamp_col: {
              type: 'timestamp',
              nullable: false,
            },
            json_col: {
              type: 'json',
              nullable: false,
            },
            jsonb_col: {
              type: 'jsonb',
              nullable: false,
            },
            unknown_col: {
              type: 'unknown_type' as any,
              nullable: false,
            },
          },
          primaryKey: { kind: 'primaryKey', columns: ['int4_col'] },
          uniques: [],
          foreignKeys: [],
          indexes: [],
          capabilities: [],
          meta: { source: 'model Test' },
        },
      },
    };

    const result = emitContractTypes(schemaWithVariousTypes);

    expect(result).toContain('int4_col: number;');
    expect(result).toContain('int8_col: number;');
    expect(result).toContain('float4_col: number;');
    expect(result).toContain('float8_col: number;');
    expect(result).toContain('text_col: string;');
    expect(result).toContain('varchar_col: string;');
    expect(result).toContain('uuid_col: string;');
    expect(result).toContain('bool_col: boolean;');
    expect(result).toContain('timestamptz_col: Date;');
    expect(result).toContain('timestamp_col: Date;');
    expect(result).toContain('json_col: any;');
    expect(result).toContain('jsonb_col: any;');
    expect(result).toContain('unknown_col: unknown;');
  });

  it('handles tables with multiple unique constraints', () => {
    const schemaWithMultipleUniques: Schema = {
      target: 'postgres',
      tables: {
        user: {
          columns: {
            id: {
              type: 'int4',
              pk: true,
              nullable: false,
            },
            email: {
              type: 'text',
              unique: true,
              nullable: false,
            },
            username: {
              type: 'text',
              unique: true,
              nullable: false,
            },
          },
          primaryKey: { kind: 'primaryKey', columns: ['id'] },
          uniques: [
            { kind: 'unique', columns: ['email'] },
            { kind: 'unique', columns: ['username'] },
          ],
          foreignKeys: [],
          indexes: [],
          capabilities: [],
          meta: { source: 'model User' },
        },
      },
    };

    const result = emitContractTypes(schemaWithMultipleUniques);

    expect(result).toContain("user:       ['id'] |       ['email'] |       ['username'];");
  });

  it('generates valid TypeScript syntax', () => {
    const result = emitContractTypes(mockSchema);

    // Basic syntax checks
    expect(result).toMatch(/export namespace \w+ \{/);
    expect(result).toMatch(/export interface \w+Shape \{/);
    expect(result).toMatch(/export type Tables = \{/);
    expect(result).toMatch(/export type Relations = \{/);
    expect(result).toMatch(/export type Uniques = \{/);

    // Check that all braces are balanced
    const openBraces = (result.match(/\{/g) || []).length;
    const closeBraces = (result.match(/\}/g) || []).length;
    expect(openBraces).toBe(closeBraces);
  });
});
