import { describe, it, expect } from 'vitest';
import { planMigration } from '../src/planner';
import { Contract } from '../src/planner/types';

describe('Migration Planner', () => {
  describe('Empty to Contract', () => {
    it('generates addTable operations with all constraints', async () => {
      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true, default: { kind: 'autoincrement' } },
              email: { type: 'text', nullable: false, unique: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [{ kind: 'unique', columns: ['email'] }],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const result = await planMigration({ kind: 'empty' }, contractB);

      expect(result.opset.operations).toHaveLength(1);
      expect(result.opset.operations[0]).toMatchObject({
        kind: 'addTable',
        name: 'user',
        columns: expect.arrayContaining([
          expect.objectContaining({ name: 'id', type: 'int4', nullable: false }),
          expect.objectContaining({ name: 'email', type: 'text', nullable: false }),
        ]),
        constraints: expect.arrayContaining([
          expect.objectContaining({ kind: 'primaryKey', columns: ['id'] }),
          expect.objectContaining({ kind: 'unique', columns: ['email'] }),
        ]),
      });
    });
  });

  describe('Add Column', () => {
    it('adds nullable column successfully', async () => {
      const contractA: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test456',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              email: { type: 'text', nullable: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const result = await planMigration(contractA, contractB);

      expect(result.opset.operations).toHaveLength(1);
      expect(result.opset.operations[0]).toMatchObject({
        kind: 'addColumn',
        table: 'user',
        column: expect.objectContaining({
          name: 'email',
          type: 'text',
          nullable: true,
        }),
      });
    });

    it('adds NOT NULL column with default successfully', async () => {
      const contractA: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test456',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              active: {
                type: 'bool',
                nullable: false,
                default: { kind: 'literal', value: 'true' },
              },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const result = await planMigration(contractA, contractB);

      expect(result.opset.operations).toHaveLength(1);
      expect(result.opset.operations[0]).toMatchObject({
        kind: 'addColumn',
        table: 'user',
        column: expect.objectContaining({
          name: 'active',
          type: 'bool',
          nullable: false,
          default: { kind: 'literal', value: 'true' },
        }),
      });
    });

    it('fails on NOT NULL column without default', async () => {
      const contractA: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test456',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              name: { type: 'text', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      await expect(planMigration(contractA, contractB)).rejects.toThrow(
        "Column 'user.name' added as NOT NULL without default. Make it nullable or add a default.",
      );
    });
  });

  describe('Add Unique Constraint', () => {
    it('adds unique constraint with deterministic naming', async () => {
      const contractA: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              email: { type: 'text', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test456',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              email: { type: 'text', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [{ kind: 'unique', columns: ['email'] }],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const result = await planMigration(contractA, contractB);

      expect(result.opset.operations).toHaveLength(1);
      expect(result.opset.operations[0]).toMatchObject({
        kind: 'addUnique',
        table: 'user',
        columns: ['email'],
        name: 'user_email_key',
      });
    });
  });

  describe('Add Index', () => {
    it('adds index with deterministic naming', async () => {
      const contractA: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              email: { type: 'text', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test456',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              email: { type: 'text', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [{ columns: ['email'], unique: false }],
          },
        },
      };

      const result = await planMigration(contractA, contractB);

      expect(result.opset.operations).toHaveLength(1);
      expect(result.opset.operations[0]).toMatchObject({
        kind: 'addIndex',
        table: 'user',
        columns: [{ name: 'email' }],
        name: 'user_email_idx',
      });
    });
  });

  describe('Add Foreign Key', () => {
    it('adds foreign key with supporting index', async () => {
      const contractA: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
          post: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              user_id: { type: 'int4', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test456',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
          post: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              user_id: { type: 'int4', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [
              {
                kind: 'foreignKey',
                columns: ['user_id'],
                references: { table: 'user', columns: ['id'] },
              },
            ],
            indexes: [],
          },
        },
      };

      const result = await planMigration(contractA, contractB);

      expect(result.opset.operations).toHaveLength(2);

      // Should add supporting index first
      expect(result.opset.operations[0]).toMatchObject({
        kind: 'addIndex',
        table: 'post',
        columns: [{ name: 'user_id' }],
        name: 'post_user_id_idx',
      });

      // Then add foreign key
      expect(result.opset.operations[1]).toMatchObject({
        kind: 'addForeignKey',
        table: 'post',
        columns: ['user_id'],
        ref: { table: 'user', columns: ['id'] },
        name: 'post_user_id_fkey',
      });
    });

    it('skips supporting index when columns covered by PK', async () => {
      const contractA: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
          post: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              user_id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id', 'user_id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test456',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
          post: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              user_id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['user_id', 'id'] },
            uniques: [],
            foreignKeys: [
              {
                kind: 'foreignKey',
                columns: ['user_id'],
                references: { table: 'user', columns: ['id'] },
              },
            ],
            indexes: [],
          },
        },
      };

      const result = await planMigration(contractA, contractB);

      // Should only add foreign key, no supporting index needed
      expect(result.opset.operations).toHaveLength(1);
      expect(result.opset.operations[0]).toMatchObject({
        kind: 'addForeignKey',
        table: 'post',
        columns: ['user_id'],
        ref: { table: 'user', columns: ['id'] },
      });
    });
  });

  describe('Unsupported Changes', () => {
    it('detects table rename and fails', async () => {
      const contractA: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test456',
        tables: {
          people: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      await expect(planMigration(contractA, contractB)).rejects.toThrow(
        "Table 'user' removed and 'people' added. Renames not supported in MVP.",
      );
    });

    it('detects column drop and fails', async () => {
      const contractA: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              email: { type: 'text', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test456',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      await expect(planMigration(contractA, contractB)).rejects.toThrow(
        "Column 'user.email' present in A but absent in B. Drops not supported in MVP.",
      );
    });

    it('detects type change and fails', async () => {
      const contractA: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              age: { type: 'int4', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test456',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              age: { type: 'text', nullable: false },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      await expect(planMigration(contractA, contractB)).rejects.toThrow(
        "Column 'user.age' changed type from int4 to text. Type changes not supported in MVP.",
      );
    });
  });

  describe('Hash Stability', () => {
    it('produces same opSetHash for identical inputs', async () => {
      const contractA: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test123',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const contractB: Contract = {
        target: 'postgres',
        contractHash: 'sha256:test456',
        tables: {
          user: {
            columns: {
              id: { type: 'int4', nullable: false, pk: true },
              email: { type: 'text', nullable: true },
            },
            primaryKey: { kind: 'primaryKey', columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
      };

      const result1 = await planMigration(contractA, contractB);
      const result2 = await planMigration(contractA, contractB);

      expect(result1.opSetHash).toBe(result2.opSetHash);
      expect(result1.opset).toEqual(result2.opset);
    });
  });
});
