import type {
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresSqlEmitter } from '../../src/core/migrations/postgres-sql-emitter';

const emitter = createPostgresSqlEmitter();

describe('PostgresSqlEmitter', () => {
  describe('emitCreateTable', () => {
    it('emits CREATE TABLE with columns and primary key', () => {
      const table: StorageTable = {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          email: { nativeType: 'text', codecId: 'core/text@1', nullable: false },
          name: { nativeType: 'text', codecId: 'core/text@1', nullable: true },
        },
        primaryKey: { columns: ['id'], name: 'users_pkey' },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };

      const op = emitter.emitCreateTable({ tableName: 'users', table });

      expect(op.id).toBe('table.users');
      expect(op.label).toBe('Create table users');
      expect(op.operationClass).toBe('additive');
      expect(op.target.id).toBe('postgres');
      expect(op.execute).toHaveLength(1);
      expect(op.execute[0]!.sql).toContain('CREATE TABLE');
      expect(op.execute[0]!.sql).toContain('"users"');
      expect(op.execute[0]!.sql).toContain('"id"');
      expect(op.execute[0]!.sql).toContain('NOT NULL');
      expect(op.execute[0]!.sql).toContain('PRIMARY KEY');
      expect(op.precheck).toHaveLength(1);
      expect(op.precheck[0]!.sql).toContain('to_regclass');
      expect(op.postcheck).toHaveLength(1);
      expect(op.postcheck[0]!.sql).toContain('to_regclass');
    });

    it('emits CREATE TABLE with SERIAL for autoincrement', () => {
      const table: StorageTable = {
        columns: {
          id: {
            nativeType: 'integer',
            codecId: 'core/int@1',
            nullable: false,
            default: { kind: 'function', expression: 'autoincrement()' },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };

      const op = emitter.emitCreateTable({ tableName: 'items', table });
      expect(op.execute[0]!.sql).toContain('SERIAL');
    });

    it('emits CREATE TABLE with column defaults', () => {
      const table: StorageTable = {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          status: {
            nativeType: 'text',
            codecId: 'core/text@1',
            nullable: false,
            default: { kind: 'literal', expression: "'active'" },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };

      const op = emitter.emitCreateTable({ tableName: 'items', table });
      expect(op.execute[0]!.sql).toContain("DEFAULT 'active'");
    });

    it('emits CREATE TABLE with typeRef column', () => {
      const table: StorageTable = {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
          role: {
            nativeType: 'user_role',
            codecId: 'pg/enum@1',
            nullable: false,
            typeRef: 'UserRole',
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };

      const op = emitter.emitCreateTable({ tableName: 'users', table });
      expect(op.execute[0]!.sql).toContain('"user_role"');
    });
  });

  describe('emitAddColumn', () => {
    it('emits ALTER TABLE ADD COLUMN', () => {
      const column: StorageColumn = {
        nativeType: 'text',
        codecId: 'core/text@1',
        nullable: true,
      };

      const op = emitter.emitAddColumn({ tableName: 'users', columnName: 'bio', column });

      expect(op.id).toBe('column.users.bio');
      expect(op.label).toBe('Add column bio to users');
      expect(op.operationClass).toBe('additive');
      expect(op.execute[0]!.sql).toContain('ALTER TABLE');
      expect(op.execute[0]!.sql).toContain('ADD COLUMN');
      expect(op.execute[0]!.sql).toContain('"bio"');
    });

    it('includes tableIsEmpty precheck for NOT NULL without default', () => {
      const column: StorageColumn = {
        nativeType: 'text',
        codecId: 'core/text@1',
        nullable: false,
      };

      const op = emitter.emitAddColumn({ tableName: 'users', columnName: 'name', column });

      const emptyCheck = op.precheck.find((s) => s.sql.includes('NOT EXISTS'));
      expect(emptyCheck).toBeDefined();
    });

    it('omits tableIsEmpty precheck for NOT NULL with default', () => {
      const column: StorageColumn = {
        nativeType: 'text',
        codecId: 'core/text@1',
        nullable: false,
        default: { kind: 'literal', expression: "''" },
      };

      const op = emitter.emitAddColumn({ tableName: 'users', columnName: 'name', column });

      const emptyCheck = op.precheck.find((s) => s.description.includes('empty'));
      expect(emptyCheck).toBeUndefined();
    });
  });

  describe('emitAddPrimaryKey', () => {
    it('emits ALTER TABLE ADD CONSTRAINT PRIMARY KEY', () => {
      const op = emitter.emitAddPrimaryKey({
        tableName: 'users',
        constraintName: 'users_pkey',
        columns: ['id'],
      });

      expect(op.id).toBe('primaryKey.users.users_pkey');
      expect(op.execute[0]!.sql).toContain('ALTER TABLE');
      expect(op.execute[0]!.sql).toContain('PRIMARY KEY');
      expect(op.execute[0]!.sql).toContain('"id"');
    });
  });

  describe('emitAddUniqueConstraint', () => {
    it('emits ALTER TABLE ADD CONSTRAINT UNIQUE', () => {
      const op = emitter.emitAddUniqueConstraint({
        tableName: 'users',
        constraintName: 'users_email_key',
        columns: ['email'],
      });

      expect(op.id).toBe('unique.users.users_email_key');
      expect(op.execute[0]!.sql).toContain('UNIQUE');
      expect(op.execute[0]!.sql).toContain('"email"');
    });
  });

  describe('emitCreateIndex', () => {
    it('emits CREATE INDEX', () => {
      const op = emitter.emitCreateIndex({
        tableName: 'users',
        indexName: 'users_email_idx',
        columns: ['email'],
      });

      expect(op.id).toBe('index.users.users_email_idx');
      expect(op.execute[0]!.sql).toContain('CREATE INDEX');
      expect(op.execute[0]!.sql).toContain('"users_email_idx"');
      expect(op.execute[0]!.sql).toContain('"email"');
    });
  });

  describe('emitAddForeignKey', () => {
    it('emits ALTER TABLE ADD CONSTRAINT FOREIGN KEY', () => {
      const op = emitter.emitAddForeignKey({
        tableName: 'posts',
        constraintName: 'posts_author_fkey',
        foreignKey: {
          columns: ['author_id'],
          references: { table: 'users', columns: ['id'] },
        },
      });

      expect(op.id).toBe('foreignKey.posts.posts_author_fkey');
      expect(op.execute[0]!.sql).toContain('FOREIGN KEY');
      expect(op.execute[0]!.sql).toContain('"author_id"');
      expect(op.execute[0]!.sql).toContain('REFERENCES');
      expect(op.execute[0]!.sql).toContain('"users"');
    });
  });

  describe('emitEnableExtension', () => {
    it('emits CREATE EXTENSION', () => {
      const op = emitter.emitEnableExtension({
        extension: 'vector',
        dependencyId: 'pg/vector@1',
      });

      expect(op.id).toBe('extension.vector');
      expect(op.execute[0]!.sql).toContain('CREATE EXTENSION');
      expect(op.execute[0]!.sql).toContain('"vector"');
    });
  });

  describe('emitCreateStorageType', () => {
    it('emits CREATE TYPE for enum', () => {
      const typeInstance: StorageTypeInstance = {
        codecId: 'pg/enum@1',
        nativeType: 'user_role',
        typeParams: { values: ['admin', 'user', 'guest'] },
      };

      const op = emitter.emitCreateStorageType({
        typeName: 'UserRole',
        typeInstance,
      });

      expect(op.id).toBe('storageType.UserRole');
      expect(op.label).toBe('Create storage type UserRole');
      expect(op.execute[0]!.sql).toContain('CREATE TYPE');
      expect(op.execute[0]!.sql).toContain('"user_role"');
      expect(op.execute[0]!.sql).toContain('AS ENUM');
      expect(op.execute[0]!.sql).toContain("'admin'");
      expect(op.execute[0]!.sql).toContain("'user'");
      expect(op.execute[0]!.sql).toContain("'guest'");
    });

    it('emits metadata-only operation for non-enum types', () => {
      const typeInstance: StorageTypeInstance = {
        codecId: 'pg/vector@1',
        nativeType: 'vector',
        typeParams: { length: 1536 },
      };

      const op = emitter.emitCreateStorageType({
        typeName: 'Embedding',
        typeInstance,
      });

      expect(op.id).toBe('storageType.Embedding');
      expect(op.operationClass).toBe('additive');
    });
  });

  describe('custom schema', () => {
    it('qualifies table names with the configured schema', () => {
      const customEmitter = createPostgresSqlEmitter({ defaultSchema: 'app' });
      const table: StorageTable = {
        columns: {
          id: { nativeType: 'integer', codecId: 'core/int@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };

      const op = customEmitter.emitCreateTable({ tableName: 'users', table });
      expect(op.execute[0]!.sql).toContain('"app"."users"');
    });
  });
});
