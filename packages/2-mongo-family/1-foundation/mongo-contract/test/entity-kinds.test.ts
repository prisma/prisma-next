import { hydrateNamespaceEntities } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { collectionEntityKind, composeMongoEntityKinds } from '../src/entity-kinds';
import { MongoCollection } from '../src/ir/mongo-collection';

const minimalCollectionInput = {};

describe('collectionEntityKind', () => {
  it('construct produces MongoCollection instances', () => {
    const result = collectionEntityKind.construct(minimalCollectionInput);
    expect(result).toBeInstanceOf(MongoCollection);
  });
});

describe('composeMongoEntityKinds', () => {
  it('includes collection by default', () => {
    const kinds = composeMongoEntityKinds();
    expect(kinds.has('collection')).toBe(true);
  });

  it('merges pack descriptors', () => {
    const synth = {
      kind: 'synthetic',
      schema: collectionEntityKind.schema,
      construct: (v: unknown) => v,
    };
    const kinds = composeMongoEntityKinds([synth]);
    expect(kinds.has('synthetic')).toBe(true);
  });

  it('throws on a duplicate entity kind', () => {
    const collide = {
      kind: 'collection',
      schema: collectionEntityKind.schema,
      construct: (v: unknown) => v,
    };
    expect(() => composeMongoEntityKinds([collide])).toThrow(/duplicate entity kind/);
  });
});

describe('hydrateNamespaceEntities with Mongo kinds (carry)', () => {
  it('constructs collection entries', () => {
    const kinds = composeMongoEntityKinds();
    const result = hydrateNamespaceEntities(
      { collection: { items: minimalCollectionInput } },
      kinds,
      'carry',
    );
    expect(result['collection']?.['items']).toBeInstanceOf(MongoCollection);
  });

  it('carries unknown kinds frozen as-is', () => {
    const kinds = composeMongoEntityKinds();
    const bogusMap = Object.freeze({ foo: { x: 1 } });
    const result = hydrateNamespaceEntities(
      { collection: {}, bogus: bogusMap } as Record<string, Record<string, unknown>>,
      kinds,
      'carry',
    );
    expect(result['bogus']).toBe(bogusMap);
    expect(Object.isFrozen(result['bogus'])).toBe(true);
  });

  it('throws for unknown kinds on fail mode', () => {
    const kinds = composeMongoEntityKinds();
    expect(() =>
      hydrateNamespaceEntities(
        { collection: {}, bogus: { x: {} } } as Record<string, Record<string, unknown>>,
        kinds,
        'fail',
        'ns-1',
      ),
    ).toThrow(/bogus/);
  });
});
