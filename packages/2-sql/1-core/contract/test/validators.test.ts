import { ContractValidationError } from '@prisma-next/contract/contract-validation-error';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { createContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { col, fk, index, model, pk, table, unique } from '../src/factories';
import type { ReferentialAction, SqlStorage } from '../src/types';
import {
  validateModel,
  validateSqlContractFully,
  validateStorage,
  validateStorageSemantics,
} from '../src/validators';

function unboundTables(tables: Record<string, unknown>) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: tables },
      },
    },
  };
}

describe('SQL contract validators', () => {
  describe('validateStorage', () => {
    it('validates valid storage', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
        email: col('text', 'pg/text@1'),
      });
      const s = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      }).storage;
      expect(() => validateStorage(s)).not.toThrow();
    });

    it('throws on invalid storage structure', () => {
      const invalid = {
        storageHash: 'sha256:test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: { table: 'not-an-object' },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('throws on invalid table structure', () => {
      const invalid = {
        storageHash: 'sha256:test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: 'not-an-object',
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('throws on invalid nativeType', () => {
      const invalid = {
        storageHash: 'sha256:test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    id: { nativeType: 123, codecId: 'pg/int4@1', nullable: false },
                  },
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('throws on invalid nullable type', () => {
      const invalid = {
        storageHash: 'sha256:test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: 'yes' },
                  },
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('throws when column declares both typeParams and typeRef', () => {
      const invalid = {
        storageHash: 'sha256:test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
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
            },
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
        storage: { table: 'user', namespaceId: UNBOUND_NAMESPACE_ID },
        fields: 'not-an-object',
        relations: {},
      } as unknown;
      expect(() => validateModel(invalid)).toThrow();
    });

    it('validates model without relations', () => {
      const modelWithoutRelations = {
        storage: {
          table: 'user',
          namespaceId: UNBOUND_NAMESPACE_ID,
          fields: { id: { column: 'id' } },
        },
        fields: {
          id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
        },
      };
      expect(() => validateModel(modelWithoutRelations)).not.toThrow();
    });
  });

  describe('validateSqlContractFully', () => {
    it('throws ContractValidationError when contract value is not an object', () => {
      try {
        validateSqlContractFully(null);
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
        storage: unboundTables({ user: userTable }),
        models: {
          User: model('user', {
            id: { column: 'id' },
            email: { column: 'email' },
          }),
        },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('throws on missing targetFamily', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, targetFamily: undefined } as unknown;
      expect(() => validateSqlContractFully(invalid)).toThrow(/targetFamily/);
    });

    it('throws ContractValidationError on wrong targetFamily', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, targetFamily: 'document' } as unknown;
      try {
        validateSqlContractFully(invalid);
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
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, target: undefined } as unknown;
      try {
        validateSqlContractFully(invalid);
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
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, storage: { ...c.storage, storageHash: undefined } } as unknown;
      expect(() => validateSqlContractFully(invalid)).toThrow(/storageHash/);
    });

    it('throws on missing storage', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, storage: undefined } as unknown;
      expect(() => validateSqlContractFully(invalid)).toThrow(/storage/);
    });

    it('throws on missing models', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, models: undefined } as unknown;
      expect(() => validateSqlContractFully(invalid)).toThrow(/models/);
    });

    it('accepts contract with profileHash', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('rejects contract without profileHash', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const { profileHash: _, ...withoutProfileHash } = c;
      expect(() => validateSqlContractFully(withoutProfileHash)).toThrow(/profileHash/);
    });

    it('accepts optional capabilities', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
        capabilities: {
          postgres: {
            returning: true,
          },
        },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('accepts optional extension packs', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
        extensionPacks: {
          postgres: {
            id: 'postgres',
            version: '0.0.1',
          },
        },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('accepts optional meta', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
        meta: {
          generated: true,
        },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('rejects unknown top-level keys', () => {
      const userTable = table({ id: col('int4', 'pg/int4@1') });
      const base = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const c = {
        ...base,
        mappings: { modelToTable: { User: 'user' } },
      };
      expect(() => validateSqlContractFully(c)).toThrow('mappings must be removed');
    });

    it('validates FK with per-FK constraint and index fields', () => {
      const userTable = table({ id: col('int4', 'pg/int4@1') }, { pk: pk('id') });
      const postTable = table(
        { id: col('int4', 'pg/int4@1'), userId: col('int4', 'pg/int4@1') },
        {
          pk: pk('id'),
          fks: [fk('post', ['userId'], 'user', ['id'], { constraint: true, index: true })],
        },
      );
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable, post: postTable }),
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('validates FK with constraint disabled', () => {
      const userTable = table({ id: col('int4', 'pg/int4@1') }, { pk: pk('id') });
      const postTable = table(
        { id: col('int4', 'pg/int4@1'), userId: col('int4', 'pg/int4@1') },
        {
          pk: pk('id'),
          fks: [fk('post', ['userId'], 'user', ['id'], { constraint: false, index: true })],
        },
      );
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable, post: postTable }),
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('rejects FK missing constraint field', () => {
      const rawContract = createContract({
        storage: unboundTables({
          user: {
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
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
                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
                index: true,
              },
            ],
          },
        }),
      });
      expect(() => validateSqlContractFully(rawContract)).toThrow();
    });

    it('rejects FK missing index field', () => {
      const rawContract = createContract({
        storage: unboundTables({
          user: {
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
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
                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
                constraint: true,
              },
            ],
          },
        }),
      });
      expect(() => validateSqlContractFully(rawContract)).toThrow();
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
          { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: action })] },
        );
        const s = createContract<SqlStorage>({
          storage: unboundTables({ post: postTable }),
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
        {
          fks: [
            fk('post', ['userId'], 'user', ['id'], { onDelete: 'cascade', onUpdate: 'noAction' }),
          ],
        },
      );
      const s = createContract<SqlStorage>({
        storage: unboundTables({ post: postTable }),
      }).storage;
      expect(() => validateStorage(s)).not.toThrow();
    });

    it('throws on invalid referential action string', () => {
      const invalid = {
        storageHash: 'sha256:test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                    userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  },
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
                      onDelete: 'invalidAction',
                      constraint: true,
                      index: true,
                    },
                  ],
                },
              },
            },
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
          fks: [fk('post', ['userId'], 'user', ['id'], { constraint: false, index: false })],
        },
      );
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable, post: postTable }),
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('rejects FK whose source coordinates do not match the owning table', () => {
      const rawContract = createContract({
        storage: unboundTables({
          user: {
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
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
                  tableName: 'wrongTable',
                  columns: ['userId'],
                },
                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
                constraint: true,
                index: true,
              },
            ],
          },
        }),
      });
      expect(() => validateSqlContractFully(rawContract)).toThrow(/mismatched source coordinates/);
    });

    it('resolves cross-namespace FK targets by namespaceId, not by bare table name', () => {
      const rawContract = createContract({
        storage: {
          storageHash: 'sha256:cross-ns',
          namespaces: {
            auth: {
              id: 'auth',
              entries: {
                table: {
                  users: {
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
            },
            analytics: {
              id: 'analytics',
              entries: {
                table: {
                  users: {
                    columns: {
                      user_uuid: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                    },
                    primaryKey: { columns: ['user_uuid'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                  events: {
                    columns: {
                      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                      user_uuid: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [
                      {
                        source: {
                          namespaceId: 'analytics',
                          tableName: 'events',
                          columns: ['user_uuid'],
                        },
                        target: {
                          namespaceId: 'analytics',
                          tableName: 'users',
                          columns: ['user_uuid'],
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
      expect(() => validateSqlContractFully(rawContract)).not.toThrow();
    });

    it('rejects an FK whose target namespaceId points at a different namespace whose same-named table lacks the referenced column', () => {
      // Same fixture as above but the FK target.namespaceId is "auth" instead
      // of "analytics". Pre-fix this validated against the workspace-wide
      // table-name set and silently accepted, because "users" existed in
      // analytics. With namespace-qualified resolution it correctly resolves
      // to auth.users — which has only column "id", not "user_uuid".
      const rawContract = createContract({
        storage: {
          storageHash: 'sha256:cross-ns-mismatch',
          namespaces: {
            auth: {
              id: 'auth',
              entries: {
                table: {
                  users: {
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
            },
            analytics: {
              id: 'analytics',
              entries: {
                table: {
                  users: {
                    columns: {
                      user_uuid: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                    },
                    primaryKey: { columns: ['user_uuid'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                  events: {
                    columns: {
                      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                      user_uuid: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [
                      {
                        source: {
                          namespaceId: 'analytics',
                          tableName: 'events',
                          columns: ['user_uuid'],
                        },
                        target: {
                          namespaceId: 'auth',
                          tableName: 'users',
                          columns: ['user_uuid'],
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
      expect(() => validateSqlContractFully(rawContract)).toThrow(
        /non-existent column "user_uuid" in table "users"/,
      );
    });
  });

  describe('validateStorageSemantics', () => {
    it('rejects setNull on non-nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('int4', 'pg/int4@1'),
              userId: col('int4', 'pg/int4@1', false),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'setNull' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setNull');
      expect(errors[0]).toContain('userId');
    });

    it('allows setNull on nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('int4', 'pg/int4@1'),
              userId: col('int4', 'pg/int4@1', true),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'setNull' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('allows cascade on non-nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('int4', 'pg/int4@1'),
              userId: col('int4', 'pg/int4@1', false),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'cascade' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('rejects setNull on onUpdate for non-nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('int4', 'pg/int4@1'),
              userId: col('int4', 'pg/int4@1', false),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onUpdate: 'setNull' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setNull');
    });

    it('rejects setDefault on non-nullable FK column without DEFAULT', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('int4', 'pg/int4@1'),
              userId: col('int4', 'pg/int4@1', false),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'setDefault' })] },
          ),
        }),
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
        storage: unboundTables({
          user: table({ id: col('int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('int4', 'pg/int4@1'),
              userId: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
                default: { kind: 'literal', value: 0 },
              },
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'setDefault' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('allows setDefault on nullable FK column without DEFAULT', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('int4', 'pg/int4@1'),
              userId: col('int4', 'pg/int4@1', true),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'setDefault' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('rejects setDefault on onUpdate for non-nullable FK column without DEFAULT', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('int4', 'pg/int4@1'),
              userId: col('int4', 'pg/int4@1', false),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onUpdate: 'setDefault' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setDefault');
    });

    it('rejects duplicate named objects within the same table', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
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
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('user_pkey');
      expect(errors[0]).toContain('primary key');
      expect(errors[0]).toContain('index');
    });

    it('rejects duplicate unique and index definitions within the same table', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
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
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('duplicate unique constraint definition');
      expect(errors[1]).toContain('duplicate index definition');
    });

    it('rejects duplicate columns inside key, unique, and index definitions', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('int4', 'pg/int4@1'),
              email: col('text', 'pg/text@1'),
            },
            {
              pk: pk('id', 'id'),
              uniques: [unique('email', 'email')],
              indexes: [index('email', 'email')],
            },
          ),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(3);
      expect(errors[0]).toContain('primary key');
      expect(errors[0]).toContain('duplicate column "id"');
      expect(errors[1]).toContain('unique constraint');
      expect(errors[1]).toContain('duplicate column "email"');
      expect(errors[2]).toContain('index');
      expect(errors[2]).toContain('duplicate column "email"');
    });

    it('rejects nullable primary-key columns', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('int4', 'pg/int4@1', true),
            },
            {
              pk: pk('id'),
            },
          ),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('primary key column "id"');
      expect(errors[0]).toContain('NOT NULL');
    });

    it('detects duplicate index definitions whose options differ only in key order', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('int4', 'pg/int4@1'),
              email: col('text', 'pg/text@1'),
            },
            {
              indexes: [
                { columns: ['email'], type: 'gin', options: { a: '1', b: '2' } },
                { columns: ['email'], type: 'gin', options: { b: '2', a: '1' } },
              ],
            },
          ),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('duplicate index definition');
    });

    it('rejects duplicate foreign key definitions within the same table', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('int4', 'pg/int4@1'),
              orgId: col('int4', 'pg/int4@1'),
            },
            {
              fks: [
                fk('user', ['orgId'], 'org', ['id'], { onDelete: 'cascade' }),
                fk('user', ['orgId'], 'org', ['id'], { onDelete: 'cascade' }),
              ],
            },
          ),
          org: table({
            id: col('int4', 'pg/int4@1'),
          }),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('duplicate foreign key definition');
    });

    it('returns no errors for storage without FKs', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('int4', 'pg/int4@1') }),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateSqlContractFully strict mode', () => {
    it('rejects unknown top-level properties', () => {
      const c = createContract<SqlStorage>({
        storage: unboundTables({ users: table({ id: col('int4', 'pg/int4@1') }) }),
        models: { User: model('users', { id: { column: 'id' } }) },
      });
      const withUnknown = { ...c, bogusField: 'unexpected' };
      expect(() => validateSqlContractFully(withUnknown)).toThrow();
    });

    it('accepts valid contracts without unknown properties', () => {
      const c = createContract<SqlStorage>({
        storage: unboundTables({ users: table({ id: col('int4', 'pg/int4@1') }) }),
        models: { User: model('users', { id: { column: 'id' } }) },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });
  });
});
