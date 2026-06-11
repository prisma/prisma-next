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

describe('DDL lowering oracle — createCollection', () => {
  it('bare collection → {create, no options}', async () => {
    const wire = await lowerCmd(new CreateCollectionCommand('orders'));
    expect(wire).toMatchObject({ kind: 'createCollection', collection: 'orders', options: {} });
  });

  it('capped + size + max', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('logs', { capped: true, size: 1048576, max: 1000 }),
    );
    expect(wire).toMatchObject({
      kind: 'createCollection',
      collection: 'logs',
      options: { capped: true, size: 1048576, max: 1000 },
    });
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
    expect(wire).toMatchObject({
      kind: 'createCollection',
      collection: 'docs',
      options: { validator, validationLevel: 'strict', validationAction: 'error' },
    });
  });

  it('collation', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('items', { collation: { locale: 'en', strength: 2 } }),
    );
    expect(wire).toMatchObject({
      kind: 'createCollection',
      collection: 'items',
      options: { collation: { locale: 'en', strength: 2 } },
    });
  });

  it('timeseries', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('readings', {
        timeseries: { timeField: 'ts', granularity: 'hours' },
      }),
    );
    expect(wire).toMatchObject({
      kind: 'createCollection',
      collection: 'readings',
      options: { timeseries: { timeField: 'ts', granularity: 'hours' } },
    });
  });

  it('clusteredIndex', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('clustered', {
        clusteredIndex: { key: { _id: 1 }, unique: true, name: 'clustered_id' },
      }),
    );
    expect(wire).toMatchObject({
      kind: 'createCollection',
      collection: 'clustered',
      options: { clusteredIndex: { key: { _id: 1 }, unique: true, name: 'clustered_id' } },
    });
  });

  it('changeStreamPreAndPostImages', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('events', {
        changeStreamPreAndPostImages: { enabled: true },
      }),
    );
    expect(wire).toMatchObject({
      kind: 'createCollection',
      collection: 'events',
      options: { changeStreamPreAndPostImages: { enabled: true } },
    });
  });

  it('omits undefined options', async () => {
    const wire = await lowerCmd(new CreateCollectionCommand('plain'));
    expect(wire).toMatchObject({ kind: 'createCollection', collection: 'plain', options: {} });
    const opts = (wire as { options: Record<string, unknown> }).options;
    expect(Object.keys(opts)).toHaveLength(0);
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
    expect(wire).toMatchObject({
      kind: 'createIndex',
      collection: 'users',
      key: { email: 1 },
      options: { unique: true, name: 'email_1' },
    });
  });

  it('sparse + expireAfterSeconds (TTL)', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('sessions', [{ field: 'createdAt', direction: 1 }], {
        sparse: true,
        expireAfterSeconds: 3600,
        name: 'createdAt_1',
      }),
    );
    expect(wire).toMatchObject({
      kind: 'createIndex',
      collection: 'sessions',
      key: { createdAt: 1 },
      options: { sparse: true, expireAfterSeconds: 3600, name: 'createdAt_1' },
    });
  });

  it('partialFilterExpression', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('logs', [{ field: 'level', direction: 1 }], {
        partialFilterExpression: { active: true },
        name: 'level_1_partial',
      }),
    );
    expect(wire).toMatchObject({
      kind: 'createIndex',
      collection: 'logs',
      key: { level: 1 },
      options: { partialFilterExpression: { active: true }, name: 'level_1_partial' },
    });
  });

  it('wildcardProjection', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('products', [{ field: '$**', direction: 1 }], {
        wildcardProjection: { name: 1 },
        name: 'wildcard_1',
      }),
    );
    expect(wire).toMatchObject({
      kind: 'createIndex',
      collection: 'products',
      key: { '$**': 1 },
      options: { wildcardProjection: { name: 1 }, name: 'wildcard_1' },
    });
  });

  it('collation', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('items', [{ field: 'name', direction: 1 }], {
        collation: { locale: 'en', strength: 2 },
        name: 'name_1_en',
      }),
    );
    expect(wire).toMatchObject({
      kind: 'createIndex',
      collection: 'items',
      key: { name: 1 },
      options: { collation: { locale: 'en', strength: 2 }, name: 'name_1_en' },
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
    expect(wire).toMatchObject({
      kind: 'createIndex',
      collection: 'articles',
      key: { title: 'text', body: 'text' },
      options: {
        weights: { title: 10, body: 1 },
        default_language: 'english',
        language_override: 'lang',
        name: 'articles_text',
      },
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
    expect(wire).toMatchObject({
      kind: 'createIndex',
      collection: 'orders',
      key: { userId: 1, createdAt: -1 },
      options: { name: 'userId_1_createdAt_-1' },
    });
  });

  it('omits undefined options', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('bare', [{ field: 'x', direction: 1 }], { name: 'x_1' }),
    );
    const opts = (wire as { options: Record<string, unknown> }).options;
    expect(opts['unique']).toBeUndefined();
    expect(opts['sparse']).toBeUndefined();
    expect(opts['expireAfterSeconds']).toBeUndefined();
  });
});

describe('DDL lowering oracle — dropCollection', () => {
  it('produces {drop: collection}', async () => {
    const wire = await lowerCmd(new DropCollectionCommand('archive'));
    expect(wire).toMatchObject({ kind: 'dropCollection', collection: 'archive' });
  });
});

describe('DDL lowering oracle — dropIndex', () => {
  it('produces {dropIndexes: collection, index: name}', async () => {
    const wire = await lowerCmd(new DropIndexCommand('users', 'email_1'));
    expect(wire).toMatchObject({ kind: 'dropIndex', collection: 'users', name: 'email_1' });
  });
});

describe('DDL lowering oracle — collMod', () => {
  it('bare collMod (no options) → empty options object', async () => {
    const wire = await lowerCmd(new CollModCommand('docs', {}));
    expect(wire).toMatchObject({ kind: 'collMod', collection: 'docs', options: {} });
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
    expect(wire).toMatchObject({
      kind: 'collMod',
      collection: 'docs',
      options: { validator, validationLevel: 'moderate', validationAction: 'warn' },
    });
  });

  it('changeStreamPreAndPostImages', async () => {
    const wire = await lowerCmd(
      new CollModCommand('events', { changeStreamPreAndPostImages: { enabled: true } }),
    );
    expect(wire).toMatchObject({
      kind: 'collMod',
      collection: 'events',
      options: { changeStreamPreAndPostImages: { enabled: true } },
    });
  });
});
