import { describe, expect, it } from 'vitest';
import { col, contract, fk, model, pk, storage, table } from '../src/factories';
import type { ReferentialAction } from '../src/types';
import {
  validateModel,
  validateSqlContract,
  validateStorage,
  validateStorageSemantics,
} from '../src/validators';

describe('SQL contract validators', () => {
  describe('validateStorage', () => {
    it('validates valid storage', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
        email: col('text', 'pg/text@1'),
      });
      const s = storage({ user: userTable });
      expect(() => validateStorage(s)).not.toThrow();
    });

    it('throws on invalid storage structure', () => {
      const invalid = { tables: 'not-an-object' } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('throws on invalid table structure', () => {
      const invalid = {
        tables: {
          user: {
            columns: 'not-an-object',
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('throws on invalid nativeType', () => {
      const invalid = {
        tables: {
          user: {
            columns: {
              id: { nativeType: 123, nullable: false },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('throws on invalid nullable type', () => {
      const invalid = {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: 'yes' },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('throws when column declares both typeParams and typeRef', () => {
      const invalid = {
        tables: {
          user: {
            columns: {
              embedding: {
                nativeType: 'vector',
                codecId: 'pg/vector@1',
                nullable: false,
                typeParams: { dimensions: 1536 },
                typeRef: 'vector_1536',
              },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow(/either typeParams or typeRef, not both/);
    });
  });

  describe('validateModel', () => {
    it('validates valid model', () => {
      const userModel = model('user', {
        id: { column: 'id' },
        email: { column: 'email' },
      });
      expect(() => validateModel(userModel)).not.toThrow();
    });

    it('throws on invalid model structure', () => {
      const invalid = { storage: 'not-an-object' } as unknown;
      expect(() => validateModel(invalid)).toThrow();
    });

    it('throws on missing storage.table', () => {
      const invalid = {
        storage: {},
        fields: {},
        relations: {},
      } as unknown;
      expect(() => validateModel(invalid)).toThrow();
    });

    it('throws on invalid fields structure', () => {
      const invalid = {
        storage: { table: 'user' },
        fields: 'not-an-object',
        relations: {},
      } as unknown;
      expect(() => validateModel(invalid)).toThrow();
    });
  });

  describe('validateSqlContract', () => {
    it('throws when contract value is not an object', () => {
      expect(() => validateSqlContract(null)).toThrow(/value must be an object/);
    });

    it('validates valid contract', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
        email: col('text', 'pg/text@1'),
      });
      const s = storage({ user: userTable });
      const m = {
        User: model('user', {
          id: { column: 'id' },
          email: { column: 'email' },
        }),
      };
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        models: m,
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('throws on missing targetFamily', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      const invalid = { ...c, targetFamily: undefined } as unknown;
      expect(() => validateSqlContract(invalid)).toThrow(/targetFamily/);
    });

    it('throws on wrong targetFamily', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      const invalid = { ...c, targetFamily: 'document' } as unknown;
      expect(() => validateSqlContract(invalid)).toThrow(/Unsupported target family/);
    });

    it('throws on missing target', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      const invalid = { ...c, target: undefined } as unknown;
      expect(() => validateSqlContract(invalid)).toThrow(/target/);
    });

    it('throws on missing storageHash', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      const invalid = { ...c, storageHash: undefined } as unknown;
      expect(() => validateSqlContract(invalid)).toThrow(/storageHash/);
    });

    it('throws on missing storage', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      const invalid = { ...c, storage: undefined } as unknown;
      expect(() => validateSqlContract(invalid)).toThrow(/storage/);
    });

    it('throws on missing models', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      const invalid = { ...c, models: undefined } as unknown;
      expect(() => validateSqlContract(invalid)).toThrow(/models/);
    });

    it('accepts optional profileHash', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        profileHash: 'sha256:def456',
        storage: s,
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('accepts optional capabilities', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        capabilities: {
          postgres: {
            returning: true,
          },
        },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('accepts optional extension packs', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        extensionPacks: {
          postgres: {
            id: 'postgres',
            version: '0.0.1',
          },
        },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('accepts optional meta', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        meta: {
          generated: true,
        },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('accepts optional sources', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        sources: {
          userView: {
            kind: 'view',
            sql: 'SELECT * FROM "user"',
          },
        },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('validates FK with per-FK constraint and index fields', () => {
      const userTable = table({ id: col('int4', 'pg/int4@1') }, { pk: pk('id') });
      const postTable = table(
        { id: col('int4', 'pg/int4@1'), userId: col('int4', 'pg/int4@1') },
        {
          pk: pk('id'),
          fks: [fk(['userId'], 'user', ['id'], { constraint: true, index: true })],
        },
      );
      const s = storage({ user: userTable, post: postTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('validates FK with constraint disabled', () => {
      const userTable = table({ id: col('int4', 'pg/int4@1') }, { pk: pk('id') });
      const postTable = table(
        { id: col('int4', 'pg/int4@1'), userId: col('int4', 'pg/int4@1') },
        {
          pk: pk('id'),
          fks: [fk(['userId'], 'user', ['id'], { constraint: false, index: true })],
        },
      );
      const s = storage({ user: userTable, post: postTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('rejects FK missing constraint field', () => {
      const userTable = table({ id: col('int4', 'pg/int4@1') }, { pk: pk('id') });
      const s = storage({
        user: userTable,
        post: table(
          { id: col('int4', 'pg/int4@1'), userId: col('int4', 'pg/int4@1') },
          {
            pk: pk('id'),
            fks: [fk(['userId'], 'user', ['id'])],
          },
        ),
      });
      // Remove constraint field to simulate non-normalized FK
      const rawContract = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      const postFk = rawContract.storage.tables['post']?.foreignKeys[0] as Record<string, unknown>;
      delete postFk['constraint'];
      expect(() => validateSqlContract(rawContract)).toThrow();
    });

    it('rejects FK missing index field', () => {
      const userTable = table({ id: col('int4', 'pg/int4@1') }, { pk: pk('id') });
      const s = storage({
        user: userTable,
        post: table(
          { id: col('int4', 'pg/int4@1'), userId: col('int4', 'pg/int4@1') },
          {
            pk: pk('id'),
            fks: [fk(['userId'], 'user', ['id'])],
          },
        ),
      });
      // Remove index field to simulate non-normalized FK
      const rawContract = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      const postFk = rawContract.storage.tables['post']?.foreignKeys[0] as Record<string, unknown>;
      delete postFk['index'];
      expect(() => validateSqlContract(rawContract)).toThrow();
    });

    it('validates storage with FK referential actions', () => {
      const actions: ReferentialAction[] = [
        'noAction',
        'restrict',
        'cascade',
        'setNull',
        'setDefault',
      ];
      for (const action of actions) {
        const postTable = table(
          {
            id: col('int4', 'pg/int4@1'),
            userId: col('int4', 'pg/int4@1'),
          },
          { fks: [fk(['userId'], 'user', ['id'], { onDelete: action })] },
        );
        const s = storage({ post: postTable });
        expect(() => validateStorage(s)).not.toThrow();
      }
    });

    it('validates storage with FK onDelete and onUpdate', () => {
      const postTable = table(
        {
          id: col('int4', 'pg/int4@1'),
          userId: col('int4', 'pg/int4@1'),
        },
        { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'cascade', onUpdate: 'noAction' })] },
      );
      const s = storage({ post: postTable });
      expect(() => validateStorage(s)).not.toThrow();
    });

    it('throws on invalid referential action string', () => {
      const invalid = {
        tables: {
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id'] },
                onDelete: 'invalidAction',
              },
            ],
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('validates FK with both disabled', () => {
      const userTable = table({ id: col('int4', 'pg/int4@1') }, { pk: pk('id') });
      const postTable = table(
        { id: col('int4', 'pg/int4@1'), userId: col('int4', 'pg/int4@1') },
        {
          pk: pk('id'),
          fks: [fk(['userId'], 'user', ['id'], { constraint: false, index: false })],
        },
      );
      const s = storage({ user: userTable, post: postTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });
  });

  describe('validateStorageSemantics', () => {
    it('rejects setNull on non-nullable FK column', () => {
      const s = storage({
        user: table({ id: col('int4', 'pg/int4@1') }),
        post: table(
          {
            id: col('int4', 'pg/int4@1'),
            userId: col('int4', 'pg/int4@1', false),
          },
          { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'setNull' })] },
        ),
      });
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setNull');
      expect(errors[0]).toContain('userId');
    });

    it('allows setNull on nullable FK column', () => {
      const s = storage({
        user: table({ id: col('int4', 'pg/int4@1') }),
        post: table(
          {
            id: col('int4', 'pg/int4@1'),
            userId: col('int4', 'pg/int4@1', true),
          },
          { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'setNull' })] },
        ),
      });
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('allows cascade on non-nullable FK column', () => {
      const s = storage({
        user: table({ id: col('int4', 'pg/int4@1') }),
        post: table(
          {
            id: col('int4', 'pg/int4@1'),
            userId: col('int4', 'pg/int4@1', false),
          },
          { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'cascade' })] },
        ),
      });
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('rejects setNull on onUpdate for non-nullable FK column', () => {
      const s = storage({
        user: table({ id: col('int4', 'pg/int4@1') }),
        post: table(
          {
            id: col('int4', 'pg/int4@1'),
            userId: col('int4', 'pg/int4@1', false),
          },
          { fks: [fk(['userId'], 'user', ['id'], { onUpdate: 'setNull' })] },
        ),
      });
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setNull');
    });

    it('rejects setDefault on non-nullable FK column without DEFAULT', () => {
      const s = storage({
        user: table({ id: col('int4', 'pg/int4@1') }),
        post: table(
          {
            id: col('int4', 'pg/int4@1'),
            userId: col('int4', 'pg/int4@1', false),
          },
          { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'setDefault' })] },
        ),
      });
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setDefault');
      expect(errors[0]).toContain('userId');
      expect(errors[0]).toContain('NOT NULL');
      expect(errors[0]).toContain('no DEFAULT');
    });

    it('allows setDefault on non-nullable FK column with DEFAULT', () => {
      const s = storage({
        user: table({ id: col('int4', 'pg/int4@1') }),
        post: table(
          {
            id: col('int4', 'pg/int4@1'),
            userId: {
              nativeType: 'int4',
              codecId: 'pg/int4@1',
              nullable: false,
              default: { kind: 'literal', expression: '0' },
            },
          },
          { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'setDefault' })] },
        ),
      });
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('allows setDefault on nullable FK column without DEFAULT', () => {
      const s = storage({
        user: table({ id: col('int4', 'pg/int4@1') }),
        post: table(
          {
            id: col('int4', 'pg/int4@1'),
            userId: col('int4', 'pg/int4@1', true),
          },
          { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'setDefault' })] },
        ),
      });
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('rejects setDefault on onUpdate for non-nullable FK column without DEFAULT', () => {
      const s = storage({
        user: table({ id: col('int4', 'pg/int4@1') }),
        post: table(
          {
            id: col('int4', 'pg/int4@1'),
            userId: col('int4', 'pg/int4@1', false),
          },
          { fks: [fk(['userId'], 'user', ['id'], { onUpdate: 'setDefault' })] },
        ),
      });
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setDefault');
    });

    it('returns no errors for storage without FKs', () => {
      const s = storage({
        user: table({ id: col('int4', 'pg/int4@1') }),
      });
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });
  });
});
