import { describe, expect, it } from 'vitest';
import {
  createMongoEntryConstructionRegistry,
  dispatchMongoEntriesToRegistry,
} from '../src/entry-construction-registry';
import { MongoCollection } from '../src/ir/mongo-collection';

const minimalCollectionInput = {};

describe('createMongoEntryConstructionRegistry — core kinds', () => {
  it('registers collection by default', () => {
    const reg = createMongoEntryConstructionRegistry();
    expect(reg.has('collection')).toBe(true);
  });

  it('collectionFactory produces MongoCollection instances', () => {
    const reg = createMongoEntryConstructionRegistry();
    const factory = reg.get('collection');
    expect(factory).toBeDefined();
    const result = factory!(minimalCollectionInput);
    expect(result).toBeInstanceOf(MongoCollection);
  });

  it('pack factories are merged into the registry', () => {
    const synth = (v: unknown): unknown => ({ synthetic: true, raw: v });
    const reg = createMongoEntryConstructionRegistry(new Map([['synthetic', synth]]));
    expect(reg.has('synthetic')).toBe(true);
    expect(reg.get('synthetic')!({ x: 1 })).toEqual({ synthetic: true, raw: { x: 1 } });
  });

  it('throws when a pack factory collides with the collection kind', () => {
    expect(() =>
      createMongoEntryConstructionRegistry(new Map([['collection', () => ({})]])),
    ).toThrow(/collection/);
  });
});

describe('dispatchMongoEntriesToRegistry', () => {
  it('constructs collection entries via registry', () => {
    const reg = createMongoEntryConstructionRegistry();
    const result = dispatchMongoEntriesToRegistry(
      { collection: { items: minimalCollectionInput } },
      reg,
    );
    expect(result['collection']?.['items']).toBeInstanceOf(MongoCollection);
  });

  it('throws for unknown kinds', () => {
    const reg = createMongoEntryConstructionRegistry();
    expect(() =>
      dispatchMongoEntriesToRegistry(
        { collection: {}, bogus: { x: {} } } as Record<string, Record<string, unknown>>,
        reg,
      ),
    ).toThrow(/bogus/);
  });
});
