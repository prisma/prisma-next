import {
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
} from '@prisma-next/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { createMongoAdapter } from '../src/mongo-adapter';

const adapter = createMongoAdapter();

async function lowerCmd(
  command:
    | CreateCollectionCommand
    | CreateIndexCommand
    | DropCollectionCommand
    | DropIndexCommand
    | CollModCommand,
) {
  return adapter.lower({ command }, {});
}

type WireOptions = { options: Record<string, unknown> };
type WireKey = { key: Record<string, unknown> };
type WireName = { name: string };

describe('DDL lowering oracle — createCollection', () => {
  it('bare collection → {create, no options}', async () => {
    const wire = await lowerCmd(new CreateCollectionCommand('orders'));
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('orders');
    expect((wire as WireOptions).options).toEqual({});
  });

  it('capped + size + max', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('logs', { capped: true, size: 1048576, max: 1000 }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('logs');
    expect((wire as WireOptions).options).toEqual({ capped: true, size: 1048576, max: 1000 });
  });

  it('validator + validationLevel + validationAction', async () => {
    const validator = { $jsonSchema: { bsonType: 'object', required: ['name'] } };
    const wire = await lowerCmd(
      new CreateCollectionCommand('docs', {
        validator,
        validationLevel: 'strict',
        validationAction: 'error',
      }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('docs');
    expect((wire as WireOptions).options).toEqual({
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  });

  it('collation', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('items', { collation: { locale: 'en', strength: 2 } }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('items');
    expect((wire as WireOptions).options).toEqual({ collation: { locale: 'en', strength: 2 } });
  });

  it('timeseries', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('readings', {
        timeseries: { timeField: 'ts', granularity: 'hours' },
      }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('readings');
    expect((wire as WireOptions).options).toEqual({
      timeseries: { timeField: 'ts', granularity: 'hours' },
    });
  });

  it('clusteredIndex', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('clustered', {
        clusteredIndex: { key: { _id: 1 }, unique: true, name: 'clustered_id' },
      }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('clustered');
    expect((wire as WireOptions).options).toEqual({
      clusteredIndex: { key: { _id: 1 }, unique: true, name: 'clustered_id' },
    });
  });

  it('changeStreamPreAndPostImages', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('events', {
        changeStreamPreAndPostImages: { enabled: true },
      }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('events');
    expect((wire as WireOptions).options).toEqual({
      changeStreamPreAndPostImages: { enabled: true },
    });
  });

  it('omits undefined options', async () => {
    const wire = await lowerCmd(new CreateCollectionCommand('plain'));
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('plain');
    expect((wire as WireOptions).options).toEqual({});
  });
});

describe('DDL lowering oracle — createIndex', () => {
  it('simple unique index', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
        unique: true,
        name: 'email_1',
      }),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('users');
    expect((wire as WireKey).key).toEqual({ email: 1 });
    expect((wire as WireOptions).options).toEqual({ unique: true, name: 'email_1' });
  });

  it('sparse + expireAfterSeconds (TTL)', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('sessions', [{ field: 'createdAt', direction: 1 }], {
        sparse: true,
        expireAfterSeconds: 3600,
        name: 'createdAt_1',
      }),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('sessions');
    expect((wire as WireKey).key).toEqual({ createdAt: 1 });
    expect((wire as WireOptions).options).toEqual({
      sparse: true,
      expireAfterSeconds: 3600,
      name: 'createdAt_1',
    });
  });

  it('partialFilterExpression', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('logs', [{ field: 'level', direction: 1 }], {
        partialFilterExpression: { active: true },
        name: 'level_1_partial',
      }),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('logs');
    expect((wire as WireKey).key).toEqual({ level: 1 });
    expect((wire as WireOptions).options).toEqual({
      partialFilterExpression: { active: true },
      name: 'level_1_partial',
    });
  });

  it('wildcardProjection', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('products', [{ field: '$**', direction: 1 }], {
        wildcardProjection: { name: 1 },
        name: 'wildcard_1',
      }),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('products');
    expect((wire as WireKey).key).toEqual({ '$**': 1 });
    expect((wire as WireOptions).options).toEqual({
      wildcardProjection: { name: 1 },
      name: 'wildcard_1',
    });
  });

  it('collation', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('items', [{ field: 'name', direction: 1 }], {
        collation: { locale: 'en', strength: 2 },
        name: 'name_1_en',
      }),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('items');
    expect((wire as WireKey).key).toEqual({ name: 1 });
    expect((wire as WireOptions).options).toEqual({
      collation: { locale: 'en', strength: 2 },
      name: 'name_1_en',
    });
  });

  it('text index — weights, default_language, language_override', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand(
        'articles',
        [
          { field: 'title', direction: 'text' },
          { field: 'body', direction: 'text' },
        ],
        {
          weights: { title: 10, body: 1 },
          default_language: 'english',
          language_override: 'lang',
          name: 'articles_text',
        },
      ),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('articles');
    expect((wire as WireKey).key).toEqual({ title: 'text', body: 'text' });
    expect((wire as WireOptions).options).toEqual({
      weights: { title: 10, body: 1 },
      default_language: 'english',
      language_override: 'lang',
      name: 'articles_text',
    });
  });

  it('compound key', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand(
        'orders',
        [
          { field: 'userId', direction: 1 },
          { field: 'createdAt', direction: -1 },
        ],
        { name: 'userId_1_createdAt_-1' },
      ),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('orders');
    expect((wire as WireKey).key).toEqual({ userId: 1, createdAt: -1 });
    expect((wire as WireOptions).options).toEqual({ name: 'userId_1_createdAt_-1' });
  });

  it('omits undefined options', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('bare', [{ field: 'x', direction: 1 }], { name: 'x_1' }),
    );
    expect((wire as WireOptions).options).toEqual({ name: 'x_1' });
  });
});

describe('DDL lowering oracle — dropCollection', () => {
  it('produces {drop: collection}', async () => {
    const wire = await lowerCmd(new DropCollectionCommand('archive'));
    expect(wire.kind).toBe('dropCollection');
    expect(wire.collection).toBe('archive');
  });
});

describe('DDL lowering oracle — dropIndex', () => {
  it('produces {dropIndexes: collection, index: name}', async () => {
    const wire = await lowerCmd(new DropIndexCommand('users', 'email_1'));
    expect(wire.kind).toBe('dropIndex');
    expect(wire.collection).toBe('users');
    expect((wire as WireName).name).toBe('email_1');
  });
});

describe('DDL lowering oracle — collMod', () => {
  it('bare collMod (no options) → empty options object', async () => {
    const wire = await lowerCmd(new CollModCommand('docs', {}));
    expect(wire.kind).toBe('collMod');
    expect(wire.collection).toBe('docs');
    expect((wire as WireOptions).options).toEqual({});
  });

  it('validator + validationLevel + validationAction', async () => {
    const validator = { $jsonSchema: { bsonType: 'object' } };
    const wire = await lowerCmd(
      new CollModCommand('docs', {
        validator,
        validationLevel: 'moderate',
        validationAction: 'warn',
      }),
    );
    expect(wire.kind).toBe('collMod');
    expect(wire.collection).toBe('docs');
    expect((wire as WireOptions).options).toEqual({
      validator,
      validationLevel: 'moderate',
      validationAction: 'warn',
    });
  });

  it('changeStreamPreAndPostImages', async () => {
    const wire = await lowerCmd(
      new CollModCommand('events', { changeStreamPreAndPostImages: { enabled: true } }),
    );
    expect(wire.kind).toBe('collMod');
    expect(wire.collection).toBe('events');
    expect((wire as WireOptions).options).toEqual({
      changeStreamPreAndPostImages: { enabled: true },
    });
  });
});
