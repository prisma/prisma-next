import { describe, it, expect } from 'vitest';
import { planMigration } from '../src/planner';
import { Contract } from '../src/planner/types';

describe('Migration Planner Integration', () => {
  it('generates complete migration program end-to-end', async () => {
    // Contract A: user table only
    const contractA: Contract = {
      target: 'postgres',
      contractHash: 'sha256:abc123def456',
      tables: {
        user: {
          columns: {
            id: { type: 'int4', nullable: false, pk: true, default: { kind: 'autoincrement' } },
            email: { type: 'text', nullable: false },
          },
          primaryKey: { kind: 'primaryKey', columns: ['id'] },
          uniques: [],
          foreignKeys: [],
          indexes: [],
        },
      },
    };

    // Contract B: user + active column + post table with FK
    const contractB: Contract = {
      target: 'postgres',
      contractHash: 'sha256:def456ghi789',
      tables: {
        user: {
          columns: {
            id: { type: 'int4', nullable: false, pk: true, default: { kind: 'autoincrement' } },
            email: { type: 'text', nullable: false },
            active: { type: 'bool', nullable: false, default: { kind: 'literal', value: 'true' } },
          },
          primaryKey: { kind: 'primaryKey', columns: ['id'] },
          uniques: [{ kind: 'unique', columns: ['email'] }],
          foreignKeys: [],
          indexes: [],
        },
        post: {
          columns: {
            id: { type: 'int4', nullable: false, pk: true, default: { kind: 'autoincrement' } },
            title: { type: 'text', nullable: false },
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

    // Verify opset.json structure
    expect(result.opset).toMatchObject({
      version: 1,
      operations: expect.any(Array),
    });

    // Verify operations are in correct order
    expect(result.opset.operations).toHaveLength(3);

    // 1. Add table (post) - includes FK constraint
    expect(result.opset.operations[0]).toMatchObject({
      kind: 'addTable',
      name: 'post',
      constraints: expect.arrayContaining([
        expect.objectContaining({
          kind: 'foreignKey',
          columns: ['user_id'],
          ref: { table: 'user', columns: ['id'] },
        }),
      ]),
    });

    // 2. Add column (user.active)
    expect(result.opset.operations[1]).toMatchObject({
      kind: 'addColumn',
      table: 'user',
      column: expect.objectContaining({
        name: 'active',
        type: 'bool',
        nullable: false,
        default: { kind: 'literal', value: 'true' },
      }),
    });

    // 3. Add unique (user.email)
    expect(result.opset.operations[2]).toMatchObject({
      kind: 'addUnique',
      table: 'user',
      columns: ['email'],
      name: 'user_email_key',
    });

    // Verify meta.json structure
    expect(result.meta).toMatchObject({
      id: expect.stringMatching(/^\d{4}\d{2}\d{2}T\d{2}\d{2}_/),
      target: 'postgres',
      from: { kind: 'contract', hash: 'sha256:abc123def456' },
      to: { kind: 'contract', hash: 'sha256:def456ghi789' },
      opSetHash: expect.stringMatching(/^sha256:/),
      mode: 'strict',
      supersedes: [],
    });

    // Verify diff.json structure
    expect(result.diffJson).toMatchObject({
      from: 'sha256:abc123def456',
      to: 'sha256:def456ghi789',
      summary: {
        tablesAdded: 1,
        columnsAdded: 1,
        uniquesAdded: 1,
        indexesAdded: 0,
        fksAdded: 0,
      },
      changes: expect.arrayContaining([
        expect.objectContaining({ kind: 'addTable', table: 'post', columnCount: 3 }),
        expect.objectContaining({ kind: 'addColumn', table: 'user', column: 'active' }),
        expect.objectContaining({ kind: 'addUnique', table: 'user', columns: ['email'] }),
      ]),
    });

    // Verify notes.md content
    expect(result.notesMd).toContain('# Migration:');
    expect(result.notesMd).toContain('From: sha256:abc123def456');
    expect(result.notesMd).toContain('To: sha256:def456ghi789');
    expect(result.notesMd).toContain('## Summary');
    expect(result.notesMd).toContain('- Added 1 table');
    expect(result.notesMd).toContain('- Added 1 column');
    expect(result.notesMd).toContain('- Added 1 unique constraint');
    expect(result.notesMd).toContain('## Changes');
    expect(result.notesMd).toContain('Add table `post` (3 columns)');
    expect(result.notesMd).toContain('Add column `user.active` (bool, NOT NULL)');
    expect(result.notesMd).toContain('Add unique constraint on `user.email`');

    // Verify opSetHash matches computed hash
    expect(result.opSetHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('handles empty to contract migration', async () => {
    const contractB: Contract = {
      target: 'postgres',
      contractHash: 'sha256:initial123',
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

    // Verify meta.json has empty from
    expect(result.meta.from).toEqual({ kind: 'empty' });
    expect(result.diffJson.from).toBe('empty');

    // Verify notes.md mentions empty
    expect(result.notesMd).toContain('From: empty');
  });

  it('generates deterministic migration ID', async () => {
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
    const result2 = await planMigration(contractA, contractB, { id: 'custom-migration-id' });

    // Default ID should be timestamp-based
    expect(result1.meta.id).toMatch(/^\d{4}\d{2}\d{2}T\d{2}\d{2}_add-columns$/);

    // Custom ID should be used
    expect(result2.meta.id).toBe('custom-migration-id');
  });
});
