import { describe, expect, it } from 'vitest';
import { col, contract, model, storage, table } from '../src/factories';
import { validateModel, validateSqlContract, validateStorage } from '../src/validators';

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

    it('accepts optional foreignKeys config', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        foreignKeys: { constraints: true, indexes: true },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('accepts foreignKeys with constraints disabled', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        foreignKeys: { constraints: false, indexes: true },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('accepts foreignKeys with indexes disabled', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        foreignKeys: { constraints: true, indexes: false },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('accepts foreignKeys with both disabled', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        foreignKeys: { constraints: false, indexes: false },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('throws on invalid foreignKeys config (string instead of boolean)', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      const invalid = { ...c, foreignKeys: { constraints: 'yes', indexes: true } } as any;
      expect(() => validateSqlContract(invalid)).toThrow();
    });
  });
});
