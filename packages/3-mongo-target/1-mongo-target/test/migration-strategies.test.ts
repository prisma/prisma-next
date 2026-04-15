import { CreateCollectionCommand, CreateIndexCommand } from '@prisma-next/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { validatedCollection } from '../src/core/migration-strategies';

describe('validatedCollection', () => {
  it('returns a createCollection op followed by createIndex ops', () => {
    const ops = validatedCollection('users', { required: ['email', 'name'] }, [
      { keys: [{ field: 'email', direction: 1 }], unique: true },
      { keys: [{ field: 'name', direction: 1 }] },
    ]);

    expect(ops).toHaveLength(3);
    expect(ops[0]!.id).toBe('collection.users.create');
    expect(ops[1]!.id).toContain('index.users.create');
    expect(ops[2]!.id).toContain('index.users.create');
  });

  it('produces correct createCollection with validator', () => {
    const ops = validatedCollection('users', { required: ['email'] }, []);

    expect(ops).toHaveLength(1);
    const cmd = ops[0]!.execute[0]!.command as CreateCollectionCommand;
    expect(cmd).toBeInstanceOf(CreateCollectionCommand);
    expect(cmd.validator).toEqual({ $jsonSchema: { required: ['email'] } });
    expect(cmd.validationLevel).toBe('strict');
    expect(cmd.validationAction).toBe('error');
  });

  it('passes index options through to createIndex', () => {
    const ops = validatedCollection('users', { required: ['email'] }, [
      { keys: [{ field: 'email', direction: 1 }], unique: true },
    ]);

    const indexCmd = ops[1]!.execute[0]!.command as CreateIndexCommand;
    expect(indexCmd).toBeInstanceOf(CreateIndexCommand);
    expect(indexCmd.unique).toBe(true);
  });

  it('returns a flat array', () => {
    const ops = validatedCollection('users', { required: ['email'] }, [
      { keys: [{ field: 'email', direction: 1 }] },
    ]);

    expect(Array.isArray(ops)).toBe(true);
    for (const op of ops) {
      expect(op).toHaveProperty('id');
      expect(op).toHaveProperty('execute');
    }
  });

  it('handles empty indexes array', () => {
    const ops = validatedCollection('users', { required: ['email'] }, []);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe('collection.users.create');
  });

  it('all operations are additive', () => {
    const ops = validatedCollection('users', { required: ['email'] }, [
      { keys: [{ field: 'email', direction: 1 }] },
    ]);

    for (const op of ops) {
      expect(op.operationClass).toBe('additive');
    }
  });
});
