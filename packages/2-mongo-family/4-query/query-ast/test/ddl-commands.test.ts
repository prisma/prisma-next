import { describe, expect, it } from 'vitest';
import { CreateIndexCommand, DropIndexCommand } from '../src/ddl-commands';
import type { MongoDdlCommandVisitor, MongoInspectionCommandVisitor } from '../src/ddl-visitors';
import { ListCollectionsCommand, ListIndexesCommand } from '../src/inspection-commands';

describe('CreateIndexCommand', () => {
  it('constructs with required fields', () => {
    const cmd = new CreateIndexCommand('users', [{ field: 'email', direction: 1 }]);
    expect(cmd.kind).toBe('createIndex');
    expect(cmd.collection).toBe('users');
    expect(cmd.keys).toEqual([{ field: 'email', direction: 1 }]);
    expect(cmd.unique).toBeUndefined();
  });

  it('constructs with all options', () => {
    const cmd = new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
      unique: true,
      sparse: true,
      expireAfterSeconds: 3600,
      partialFilterExpression: { active: true },
      name: 'email_1',
    });
    expect(cmd.unique).toBe(true);
    expect(cmd.sparse).toBe(true);
    expect(cmd.expireAfterSeconds).toBe(3600);
    expect(cmd.partialFilterExpression).toEqual({ active: true });
    expect(cmd.name).toBe('email_1');
  });

  it('is frozen', () => {
    const cmd = new CreateIndexCommand('users', [{ field: 'email', direction: 1 }]);
    expect(() => {
      (cmd as unknown as Record<string, unknown>)['collection'] = 'other';
    }).toThrow();
  });

  it('dispatches via DDL visitor', () => {
    const cmd = new CreateIndexCommand('users', [{ field: 'email', direction: 1 }]);
    const visitor: MongoDdlCommandVisitor<string> = {
      createIndex: (c) => `create:${c.collection}`,
      dropIndex: () => 'drop',
    };
    expect(cmd.accept(visitor)).toBe('create:users');
  });
});

describe('DropIndexCommand', () => {
  it('constructs correctly', () => {
    const cmd = new DropIndexCommand('users', 'email_1');
    expect(cmd.kind).toBe('dropIndex');
    expect(cmd.collection).toBe('users');
    expect(cmd.name).toBe('email_1');
  });

  it('is frozen', () => {
    const cmd = new DropIndexCommand('users', 'email_1');
    expect(() => {
      (cmd as unknown as Record<string, unknown>)['name'] = 'other';
    }).toThrow();
  });

  it('dispatches via DDL visitor', () => {
    const cmd = new DropIndexCommand('users', 'email_1');
    const visitor: MongoDdlCommandVisitor<string> = {
      createIndex: () => 'create',
      dropIndex: (c) => `drop:${c.name}`,
    };
    expect(cmd.accept(visitor)).toBe('drop:email_1');
  });
});

describe('ListIndexesCommand', () => {
  it('constructs correctly', () => {
    const cmd = new ListIndexesCommand('users');
    expect(cmd.kind).toBe('listIndexes');
    expect(cmd.collection).toBe('users');
  });

  it('is frozen', () => {
    const cmd = new ListIndexesCommand('users');
    expect(() => {
      (cmd as unknown as Record<string, unknown>)['collection'] = 'other';
    }).toThrow();
  });

  it('dispatches via inspection visitor', () => {
    const cmd = new ListIndexesCommand('users');
    const visitor: MongoInspectionCommandVisitor<string> = {
      listIndexes: (c) => `indexes:${c.collection}`,
      listCollections: () => 'collections',
    };
    expect(cmd.accept(visitor)).toBe('indexes:users');
  });
});

describe('ListCollectionsCommand', () => {
  it('constructs correctly', () => {
    const cmd = new ListCollectionsCommand();
    expect(cmd.kind).toBe('listCollections');
  });

  it('is frozen', () => {
    const cmd = new ListCollectionsCommand();
    expect(() => {
      (cmd as unknown as Record<string, unknown>)['kind'] = 'other';
    }).toThrow();
  });

  it('dispatches via inspection visitor', () => {
    const cmd = new ListCollectionsCommand();
    const visitor: MongoInspectionCommandVisitor<string> = {
      listIndexes: () => 'indexes',
      listCollections: () => 'collections',
    };
    expect(cmd.accept(visitor)).toBe('collections');
  });
});
