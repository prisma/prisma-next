import { createContract } from '@prisma-next/contract/testing';
import { ContractValidationError } from '@prisma-next/contract/validate-contract';
import { describe, expect, it } from 'vitest';
import { col, fk, index, model, pk, table, unique } from '../src/factories';
import type { ReferentialAction, SqlStorage } from '../src/types';
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
      const s = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
      }).storage;
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

    it('validates model without relations', () => {
      const modelWithoutRelations = {
        storage: { table: 'user', fields: { id: { column: 'id' } } },
        fields: {
          id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
        },
      };
      expect(() => validateModel(modelWithoutRelations)).not.toThrow();
    });
  });

  describe('validateSqlContract', () => {
    it('throws ContractValidationError when contract value is not an object', () => {
      try {
        validateSqlContract(null);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ContractValidationError);
        expect((e as ContractValidationError).phase).toBe('structural');
        expect((e as ContractValidationError).code).toBe('CONTRACT.VALIDATION_FAILED');
        expect((e as ContractValidationError).message).toMatch(/value must be an object/);
      }
    });

    it('validates valid contract', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
        email: col('text', 'pg/text@1'),
      });
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
        models: {
          User: model('user', {
            id: { column: 'id' },
            email: { column: 'email' },
          }),
        },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('throws on missing targetFamily', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
      });
      const invalid = { ...c, targetFamily: undefined } as unknown;
      expect(() => validateSqlContract(invalid)).toThrow(/targetFamily/);
    });

    it('throws ContractValidationError on wrong targetFamily', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
      });
      const invalid = { ...c, targetFamily: 'document' } as unknown;
      try {
        validateSqlContract(invalid);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ContractValidationError);
        expect((e as ContractValidationError).phase).toBe('structural');
        expect((e as ContractValidationError).message).toMatch(/Unsupported target family/);
      }
    });

    it('throws ContractValidationError on missing target', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
      });
      const invalid = { ...c, target: undefined } as unknown;
      try {
        validateSqlContract(invalid);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ContractValidationError);
        expect((e as ContractValidationError).phase).toBe('structural');
        expect((e as ContractValidationError).message).toMatch(/target/);
      }
    });

    it('throws on missing storage.storageHash', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
      });
      const invalid = { ...c, storage: { ...c.storage, storageHash: undefined } } as unknown;
      expect(() => validateSqlContract(invalid)).toThrow(/storageHash/);
    });

    it('throws on missing storage', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
      });
      const invalid = { ...c, storage: undefined } as unknown;
      expect(() => validateSqlContract(invalid)).toThrow(/storage/);
    });

    it('throws on missing models', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
      });
      const invalid = { ...c, models: undefined } as unknown;
      expect(() => validateSqlContract(invalid)).toThrow(/models/);
    });

    it('accepts contract with profileHash', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('rejects contract without profileHash', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
      });
      const { profileHash: _, ...withoutProfileHash } = c;
      expect(() => validateSqlContract(withoutProfileHash)).toThrow(/profileHash/);
    });

    it('accepts optional capabilities', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
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
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
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
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
        meta: {
          generated: true,
        },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('rejects unknown top-level keys', () => {
      const userTable = table({ id: col('int4', 'pg/int4@1') });
      const base = createContract<SqlStorage>({
        storage: { tables: { user: userTable } },
      });
      const c = {
        ...base,
        mappings: { modelToTable: { User: 'user' } },
      };
      expect(() => validateSqlContract(c)).toThrow('mappings must be removed');
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
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable, post: postTable } },
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
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable, post: postTable } },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });

    it('rejects FK missing constraint field', () => {
      const userTable = table({ id: col('int4', 'pg/int4@1') }, { pk: pk('id') });
      const rawContract = createContract<SqlStorage>({
        storage: {
          tables: {
            user: userTable,
            post: table(
              { id: col('int4', 'pg/int4@1'), userId: col('int4', 'pg/int4@1') },
              {
                pk: pk('id'),
                fks: [fk(['userId'], 'user', ['id'])],
              },
            ),
          },
        },
      });
      const postFk = rawContract.storage.tables['post']?.foreignKeys[0] as Record<string, unknown>;
      delete postFk['constraint'];
      expect(() => validateSqlContract(rawContract)).toThrow();
    });

    it('rejects FK missing index field', () => {
      const userTable = table({ id: col('int4', 'pg/int4@1') }, { pk: pk('id') });
      const rawContract = createContract<SqlStorage>({
        storage: {
          tables: {
            user: userTable,
            post: table(
              { id: col('int4', 'pg/int4@1'), userId: col('int4', 'pg/int4@1') },
              {
                pk: pk('id'),
                fks: [fk(['userId'], 'user', ['id'])],
              },
            ),
          },
        },
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
        const s = createContract<SqlStorage>({
          storage: { tables: { post: postTable } },
        }).storage;
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
      const s = createContract<SqlStorage>({
        storage: { tables: { post: postTable } },
      }).storage;
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
      const c = createContract<SqlStorage>({
        storage: { tables: { user: userTable, post: postTable } },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });
  });

  describe('validateStorageSemantics', () => {
    it('rejects setNull on non-nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
            user: table({ id: col('int4', 'pg/int4@1') }),
            post: table(
              {
                id: col('int4', 'pg/int4@1'),
                userId: col('int4', 'pg/int4@1', false),
              },
              { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'setNull' })] },
            ),
          },
        },
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setNull');
      expect(errors[0]).toContain('userId');
    });

    it('allows setNull on nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
            user: table({ id: col('int4', 'pg/int4@1') }),
            post: table(
              {
                id: col('int4', 'pg/int4@1'),
                userId: col('int4', 'pg/int4@1', true),
              },
              { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'setNull' })] },
            ),
          },
        },
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('allows cascade on non-nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
            user: table({ id: col('int4', 'pg/int4@1') }),
            post: table(
              {
                id: col('int4', 'pg/int4@1'),
                userId: col('int4', 'pg/int4@1', false),
              },
              { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'cascade' })] },
            ),
          },
        },
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('rejects setNull on onUpdate for non-nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
            user: table({ id: col('int4', 'pg/int4@1') }),
            post: table(
              {
                id: col('int4', 'pg/int4@1'),
                userId: col('int4', 'pg/int4@1', false),
              },
              { fks: [fk(['userId'], 'user', ['id'], { onUpdate: 'setNull' })] },
            ),
          },
        },
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setNull');
    });

    it('rejects setDefault on non-nullable FK column without DEFAULT', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
            user: table({ id: col('int4', 'pg/int4@1') }),
            post: table(
              {
                id: col('int4', 'pg/int4@1'),
                userId: col('int4', 'pg/int4@1', false),
              },
              { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'setDefault' })] },
            ),
          },
        },
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setDefault');
      expect(errors[0]).toContain('userId');
      expect(errors[0]).toContain('NOT NULL');
      expect(errors[0]).toContain('no DEFAULT');
    });

    it('allows setDefault on non-nullable FK column with DEFAULT', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
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
          },
        },
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('allows setDefault on nullable FK column without DEFAULT', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
            user: table({ id: col('int4', 'pg/int4@1') }),
            post: table(
              {
                id: col('int4', 'pg/int4@1'),
                userId: col('int4', 'pg/int4@1', true),
              },
              { fks: [fk(['userId'], 'user', ['id'], { onDelete: 'setDefault' })] },
            ),
          },
        },
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('rejects setDefault on onUpdate for non-nullable FK column without DEFAULT', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
            user: table({ id: col('int4', 'pg/int4@1') }),
            post: table(
              {
                id: col('int4', 'pg/int4@1'),
                userId: col('int4', 'pg/int4@1', false),
              },
              { fks: [fk(['userId'], 'user', ['id'], { onUpdate: 'setDefault' })] },
            ),
          },
        },
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setDefault');
    });

    it('rejects duplicate named objects within the same table', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
            user: table(
              {
                id: col('int4', 'pg/int4@1'),
                email: col('text', 'pg/text@1'),
              },
              {
                pk: { columns: ['id'], name: 'user_pkey' },
                indexes: [{ columns: ['id'], name: 'user_pkey' }],
              },
            ),
          },
        },
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('user_pkey');
      expect(errors[0]).toContain('primary key');
      expect(errors[0]).toContain('index');
    });

    it('rejects duplicate unique and index definitions within the same table', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
            user: table(
              {
                id: col('int4', 'pg/int4@1'),
                email: col('text', 'pg/text@1'),
              },
              {
                uniques: [unique('email'), unique('email')],
                indexes: [index('email'), index('email')],
              },
            ),
          },
        },
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('duplicate unique constraint definition');
      expect(errors[1]).toContain('duplicate index definition');
    });

    it('rejects duplicate foreign key definitions within the same table', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
            user: table(
              {
                id: col('int4', 'pg/int4@1'),
                orgId: col('int4', 'pg/int4@1'),
              },
              {
                fks: [
                  fk(['orgId'], 'org', ['id'], { onDelete: 'cascade' }),
                  fk(['orgId'], 'org', ['id'], { onDelete: 'cascade' }),
                ],
              },
            ),
            org: table({
              id: col('int4', 'pg/int4@1'),
            }),
          },
        },
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('duplicate foreign key definition');
    });

    it('returns no errors for storage without FKs', () => {
      const s = createContract<SqlStorage>({
        storage: {
          tables: {
            user: table({ id: col('int4', 'pg/int4@1') }),
          },
        },
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateSqlContract strict mode', () => {
    it('rejects unknown top-level properties', () => {
      const c = createContract<SqlStorage>({
        storage: { tables: { users: table({ id: col('int4', 'pg/int4@1') }) } },
        models: { User: model('users', { id: { column: 'id' } }) },
      });
      const withUnknown = { ...c, bogusField: 'unexpected' };
      expect(() => validateSqlContract(withUnknown)).toThrow();
    });

    it('accepts valid contracts without unknown properties', () => {
      const c = createContract<SqlStorage>({
        storage: { tables: { users: table({ id: col('int4', 'pg/int4@1') }) } },
        models: { User: model('users', { id: { column: 'id' } }) },
      });
      expect(() => validateSqlContract(c)).not.toThrow();
    });
  });
});
