import type { MongoLoweredDraft } from '@prisma-next/mongo-lowering';
import { MongoParamRef } from '@prisma-next/mongo-value';
import { describe, expect, it } from 'vitest';
import { createMongoParamRefMutator, flattenMongoParamRefs } from '../src/param-ref-mutator';

// ─── flattenMongoParamRefs ──────────────────────────────────────────────────

describe('flattenMongoParamRefs', () => {
  it('yields MongoParamRef nodes from insertOne document fields', () => {
    const ref = new MongoParamRef('Alice');
    const draft: MongoLoweredDraft = {
      kind: 'insertOne',
      collection: 'users',
      document: { name: ref, age: 30 },
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([ref]);
  });

  it('yields MongoParamRef nodes nested inside object values', () => {
    const ref = new MongoParamRef('value');
    const draft: MongoLoweredDraft = {
      kind: 'insertOne',
      collection: 'users',
      document: { meta: { nested: ref } },
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([ref]);
  });

  it('yields MongoParamRef nodes inside array elements', () => {
    const ref1 = new MongoParamRef('a');
    const ref2 = new MongoParamRef('b');
    const draft: MongoLoweredDraft = {
      kind: 'insertMany',
      collection: 'users',
      documents: [{ name: ref1 }, { name: ref2 }],
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([ref1, ref2]);
  });

  it('yields MongoParamRef leaves from filter predicates', () => {
    const ref = new MongoParamRef('active');
    const draft: MongoLoweredDraft = {
      kind: 'deleteOne',
      collection: 'users',
      filter: { status: { $eq: ref } },
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([ref]);
  });

  it('yields MongoParamRef leaves from aggregate pipeline stages', () => {
    const ref = new MongoParamRef(10);
    const draft: MongoLoweredDraft = {
      kind: 'aggregate',
      collection: 'orders',
      pipeline: [{ $match: { amount: { $gt: ref } } }],
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([ref]);
  });

  it('yields zero entries for a raw aggregate command', () => {
    const draft: MongoLoweredDraft = {
      kind: 'rawAggregate',
      collection: 'orders',
      pipeline: [{ $match: { amount: { $gt: 10 } } }],
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([]);
  });

  it('yields zero entries for a raw insertOne command', () => {
    const draft: MongoLoweredDraft = {
      kind: 'rawInsertOne',
      collection: 'users',
      document: { name: 'Alice' },
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([]);
  });

  it('yields MongoParamRef nodes from updateOne filter and update', () => {
    const filterRef = new MongoParamRef('userId');
    const updateRef = new MongoParamRef('newRole');
    const draft: MongoLoweredDraft = {
      kind: 'updateOne',
      collection: 'users',
      filter: { id: { $eq: filterRef } },
      update: { $set: { role: updateRef } },
      upsert: false,
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([filterRef, updateRef]);
  });
});

// ─── createMongoParamRefMutator ─────────────────────────────────────────────

describe('createMongoParamRefMutator', () => {
  describe('entries()', () => {
    it('yields one entry per MongoParamRef in the draft', () => {
      const ref1 = new MongoParamRef('Alice', { codecId: 'string' });
      const ref2 = new MongoParamRef(42, { codecId: 'int' });
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref1, age: ref2 },
      };
      const mutator = createMongoParamRefMutator(draft);
      const entries = [...mutator.entries()];
      expect(entries).toHaveLength(2);
      expect(entries[0]!.value).toBe('Alice');
      expect(entries[0]!.codecId).toBe('string');
      expect(entries[1]!.value).toBe(42);
      expect(entries[1]!.codecId).toBe('int');
    });

    it('yields zero entries for raw commands', () => {
      const draft: MongoLoweredDraft = {
        kind: 'rawInsertOne',
        collection: 'users',
        document: { name: 'Alice' },
      };
      const mutator = createMongoParamRefMutator(draft);
      expect([...mutator.entries()]).toEqual([]);
    });

    it('reflects replaced values in subsequent entries() calls', () => {
      const ref = new MongoParamRef('Alice');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'Bob' }]);
      const [updated] = [...mutator.entries()];
      expect(updated!.value).toBe('Bob');
    });
  });

  describe('replaceValue() / replaceValues() — write-through', () => {
    it('replaceValues writes the new value and currentDraft() reflects it', () => {
      const ref = new MongoParamRef('Alice');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'Bob' }]);

      const updated = mutator.currentDraft();
      expect(updated.kind).toBe('insertOne');
      if (updated.kind === 'insertOne') {
        const nameRef = updated.document['name'];
        expect(nameRef).toBeInstanceOf(MongoParamRef);
        expect((nameRef as MongoParamRef).value).toBe('Bob');
      }
    });

    it('replaceValue with typed codecId-matched handle writes the new value', () => {
      const ref = new MongoParamRef('Alice', { codecId: 'encrypt' });
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator<{ encrypt: string }>(draft);
      const [entry] = [...mutator.entries()];
      if (entry?.codecId === 'encrypt') {
        mutator.replaceValue(entry.ref, 'EncryptedAlice');
      }

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertOne') {
        expect((updated.document['name'] as MongoParamRef).value).toBe('EncryptedAlice');
      }
    });

    it('replaceValues writes multiple values at once', () => {
      const ref1 = new MongoParamRef('Alice');
      const ref2 = new MongoParamRef('admin');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref1, role: ref2 },
      };
      const mutator = createMongoParamRefMutator(draft);
      const entries = [...mutator.entries()];

      mutator.replaceValues([
        { ref: entries[0]!.ref, newValue: 'Bob' },
        { ref: entries[1]!.ref, newValue: 'moderator' },
      ]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertOne') {
        expect((updated.document['name'] as MongoParamRef).value).toBe('Bob');
        expect((updated.document['role'] as MongoParamRef).value).toBe('moderator');
      }
    });

    it('preserves codecId and name on replaced MongoParamRef nodes', () => {
      const ref = new MongoParamRef('Alice', { codecId: 'encrypt', name: 'nameParam' });
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'EncryptedBob' }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertOne') {
        const nameRef = updated.document['name'] as MongoParamRef;
        expect(nameRef.value).toBe('EncryptedBob');
        expect(nameRef.codecId).toBe('encrypt');
        expect(nameRef.name).toBe('nameParam');
      }
    });

    it('handles replacement in nested objects', () => {
      const ref = new MongoParamRef('secret');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { profile: { ssn: ref } },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'encrypted-secret' }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertOne') {
        const profile = updated.document['profile'] as Record<string, unknown>;
        expect((profile['ssn'] as MongoParamRef).value).toBe('encrypted-secret');
      }
    });

    it('handles replacement in array elements', () => {
      const ref1 = new MongoParamRef('Alice');
      const ref2 = new MongoParamRef('Bob');
      const draft: MongoLoweredDraft = {
        kind: 'insertMany',
        collection: 'users',
        documents: [{ name: ref1 }, { name: ref2 }],
      };
      const mutator = createMongoParamRefMutator(draft);
      const entries = [...mutator.entries()];
      mutator.replaceValues([{ ref: entries[0]!.ref, newValue: 'enc-Alice' }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertMany') {
        expect((updated.documents[0]!['name'] as MongoParamRef).value).toBe('enc-Alice');
        expect((updated.documents[1]!['name'] as MongoParamRef).value).toBe('Bob');
      }
    });

    it('handles replacement in filter predicates', () => {
      const ref = new MongoParamRef('active');
      const draft: MongoLoweredDraft = {
        kind: 'deleteMany',
        collection: 'users',
        filter: { status: { $eq: ref } },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'inactive' }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'deleteMany') {
        const status = updated.filter['status'] as Record<string, unknown>;
        expect((status['$eq'] as MongoParamRef).value).toBe('inactive');
      }
    });

    it('handles replacement in pipeline stage values', () => {
      const ref = new MongoParamRef(100);
      const draft: MongoLoweredDraft = {
        kind: 'aggregate',
        collection: 'orders',
        pipeline: [{ $match: { amount: { $gt: ref } } }],
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 200 }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'aggregate') {
        const match = updated.pipeline[0]!['$match'] as Record<string, unknown>;
        const amount = match['amount'] as Record<string, unknown>;
        expect((amount['$gt'] as MongoParamRef).value).toBe(200);
      }
    });
  });

  describe('reference-identity fast path', () => {
    it('returns the original draft by reference when nothing is replaced', () => {
      const ref = new MongoParamRef('Alice');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator(draft);
      expect(mutator.currentDraft()).toBe(draft);
    });

    it('returns a new object (not the original) after any replacement', () => {
      const ref = new MongoParamRef('Alice');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'Bob' }]);
      expect(mutator.currentDraft()).not.toBe(draft);
    });
  });
});
