import { describe, expect, it } from 'vitest';
import {
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
} from '../src/ddl-commands';
import type { MongoDdlCommandVisitor, MongoInspectionCommandVisitor } from '../src/ddl-visitors';
import { ListCollectionsCommand, ListIndexesCommand } from '../src/inspection-commands';

function makeDdlVisitor(
  overrides?: Partial<MongoDdlCommandVisitor<string>>,
): MongoDdlCommandVisitor<string> {
  return {
    createIndex: () => 'createIndex',
    dropIndex: () => 'dropIndex',
    createCollection: () => 'createCollection',
    dropCollection: () => 'dropCollection',
    collMod: () => 'collMod',
    ...overrides,
  };
}

describe('CreateIndexCommand', () => {
  it('constructs with required fields', () => {
    const cmd = new CreateIndexCommand('users', [{ field: 'email', direction: 1 }]);
    expect(cmd.kind).toBe('createIndex');
    expect(cmd.collection).toBe('users');
    expect(cmd.keys).toEqual([{ field: 'email', direction: 1 }]);
    expect(cmd.options).toBeUndefined();
  });

  it('constructs with all options', () => {
    const cmd = new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
      unique: true,
      sparse: true,
      expireAfterSeconds: 3600,
      partialFilterExpression: { active: true },
      name: 'email_1',
    });
    expect(cmd.options?.unique).toBe(true);
    expect(cmd.options?.sparse).toBe(true);
    expect(cmd.options?.expireAfterSeconds).toBe(3600);
    expect(cmd.options?.partialFilterExpression).toEqual({ active: true });
    expect(cmd.options?.name).toBe('email_1');
  });

  it('constructs with M2 index options', () => {
    const cmd = new CreateIndexCommand('users', [{ field: 'bio', direction: 'text' }], {
      weights: { bio: 10 },
      default_language: 'english',
      language_override: 'lang',
      collation: { locale: 'en', strength: 2 },
    });
    expect(cmd.options?.weights).toEqual({ bio: 10 });
    expect(cmd.options?.default_language).toBe('english');
    expect(cmd.options?.language_override).toBe('lang');
    expect(cmd.options?.collation).toEqual({ locale: 'en', strength: 2 });
  });

  it('constructs with wildcardProjection', () => {
    const cmd = new CreateIndexCommand('users', [{ field: '$**', direction: 1 }], {
      wildcardProjection: { name: 1, email: 1 },
    });
    expect(cmd.options?.wildcardProjection).toEqual({ name: 1, email: 1 });
  });

  it('serializes options as flat top-level fields', () => {
    const cmd = new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
      unique: true,
      name: 'email_1',
    });
    const json = JSON.parse(JSON.stringify(cmd));
    expect(json).toMatchObject({
      kind: 'createIndex',
      collection: 'users',
      unique: true,
      name: 'email_1',
    });
    expect(json).not.toHaveProperty('options');
  });

  it('is frozen', () => {
    const cmd = new CreateIndexCommand('users', [{ field: 'email', direction: 1 }]);
    expect(() => {
      (cmd as unknown as Record<string, unknown>)['collection'] = 'other';
    }).toThrow();
  });

  it('dispatches via DDL visitor', () => {
    const cmd = new CreateIndexCommand('users', [{ field: 'email', direction: 1 }]);
    const visitor = makeDdlVisitor({
      createIndex: (c) => `create:${c.collection}`,
    });
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
    const visitor = makeDdlVisitor({
      dropIndex: (c) => `drop:${c.name}`,
    });
    expect(cmd.accept(visitor)).toBe('drop:email_1');
  });
});

describe('CreateCollectionCommand', () => {
  it('constructs with collection name only', () => {
    const cmd = new CreateCollectionCommand('events');
    expect(cmd.kind).toBe('createCollection');
    expect(cmd.collection).toBe('events');
    expect(cmd.options).toBeUndefined();
  });

  it('constructs with capped options', () => {
    const cmd = new CreateCollectionCommand('events', {
      capped: true,
      size: 1048576,
      max: 1000,
    });
    expect(cmd.options?.capped).toBe(true);
    expect(cmd.options?.size).toBe(1048576);
    expect(cmd.options?.max).toBe(1000);
  });

  it('constructs with validator', () => {
    const cmd = new CreateCollectionCommand('events', {
      validator: { $jsonSchema: { bsonType: 'object' } },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    expect(cmd.options?.validator).toEqual({ $jsonSchema: { bsonType: 'object' } });
    expect(cmd.options?.validationLevel).toBe('strict');
    expect(cmd.options?.validationAction).toBe('error');
  });

  it('constructs with timeseries', () => {
    const cmd = new CreateCollectionCommand('metrics', {
      timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'hours' },
    });
    expect(cmd.options?.timeseries).toEqual({
      timeField: 'ts',
      metaField: 'meta',
      granularity: 'hours',
    });
  });

  it('constructs with clusteredIndex', () => {
    const cmd = new CreateCollectionCommand('items', {
      clusteredIndex: { key: { _id: 1 }, unique: true, name: 'myCluster' },
    });
    expect(cmd.options?.clusteredIndex).toEqual({
      key: { _id: 1 },
      unique: true,
      name: 'myCluster',
    });
  });

  it('constructs with collation and changeStreamPreAndPostImages', () => {
    const cmd = new CreateCollectionCommand('items', {
      collation: { locale: 'en' },
      changeStreamPreAndPostImages: { enabled: true },
    });
    expect(cmd.options?.collation).toEqual({ locale: 'en' });
    expect(cmd.options?.changeStreamPreAndPostImages).toEqual({ enabled: true });
  });

  it('serializes options as flat top-level fields', () => {
    const cmd = new CreateCollectionCommand('events', { capped: true, size: 1048576 });
    const json = JSON.parse(JSON.stringify(cmd));
    expect(json).toMatchObject({
      kind: 'createCollection',
      collection: 'events',
      capped: true,
      size: 1048576,
    });
    expect(json).not.toHaveProperty('options');
  });

  it('serializes with no options as plain kind+collection', () => {
    const cmd = new CreateCollectionCommand('events');
    const json = JSON.parse(JSON.stringify(cmd));
    expect(json).toEqual({ kind: 'createCollection', collection: 'events' });
  });

  it('is frozen', () => {
    const cmd = new CreateCollectionCommand('events');
    expect(Object.isFrozen(cmd)).toBe(true);
  });

  it('dispatches via DDL visitor', () => {
    const cmd = new CreateCollectionCommand('events');
    const visitor = makeDdlVisitor({
      createCollection: (c) => `create:${c.collection}`,
    });
    expect(cmd.accept(visitor)).toBe('create:events');
  });
});

describe('DropCollectionCommand', () => {
  it('constructs correctly', () => {
    const cmd = new DropCollectionCommand('events');
    expect(cmd.kind).toBe('dropCollection');
    expect(cmd.collection).toBe('events');
  });

  it('is frozen', () => {
    const cmd = new DropCollectionCommand('events');
    expect(Object.isFrozen(cmd)).toBe(true);
  });

  it('dispatches via DDL visitor', () => {
    const cmd = new DropCollectionCommand('events');
    const visitor = makeDdlVisitor({
      dropCollection: (c) => `drop:${c.collection}`,
    });
    expect(cmd.accept(visitor)).toBe('drop:events');
  });
});

describe('CollModCommand', () => {
  it('constructs with validator', () => {
    const cmd = new CollModCommand('users', {
      validator: { $jsonSchema: { bsonType: 'object' } },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    expect(cmd.kind).toBe('collMod');
    expect(cmd.collection).toBe('users');
    expect(cmd.options.validator).toEqual({ $jsonSchema: { bsonType: 'object' } });
    expect(cmd.options.validationLevel).toBe('strict');
    expect(cmd.options.validationAction).toBe('error');
  });

  it('constructs with changeStreamPreAndPostImages', () => {
    const cmd = new CollModCommand('users', {
      changeStreamPreAndPostImages: { enabled: true },
    });
    expect(cmd.options.changeStreamPreAndPostImages).toEqual({ enabled: true });
  });

  it('serializes options as flat top-level fields', () => {
    const cmd = new CollModCommand('users', {
      validator: { $jsonSchema: { bsonType: 'object' } },
      validationLevel: 'strict',
    });
    const json = JSON.parse(JSON.stringify(cmd));
    expect(json).toMatchObject({
      kind: 'collMod',
      collection: 'users',
      validator: { $jsonSchema: { bsonType: 'object' } },
      validationLevel: 'strict',
    });
    expect(json).not.toHaveProperty('options');
  });

  it('is frozen', () => {
    const cmd = new CollModCommand('users', { validationLevel: 'strict' });
    expect(Object.isFrozen(cmd)).toBe(true);
  });

  it('dispatches via DDL visitor', () => {
    const cmd = new CollModCommand('users', { validationLevel: 'strict' });
    const visitor = makeDdlVisitor({
      collMod: (c) => `collMod:${c.collection}`,
    });
    expect(cmd.accept(visitor)).toBe('collMod:users');
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
