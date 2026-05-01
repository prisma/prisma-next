import { MongoParamRef } from '@prisma-next/mongo-value';
import { describe, expect, it } from 'vitest';
import { createMongoParamRefMutator, flattenMongoParamRefs } from '../src/mongo-param-ref-mutator';

describe('MongoParamRefMutator (AC-FAM2)', () => {
  it('flattenMongoParamRefs walks objects, arrays, and nested leaves in pre-order', () => {
    const a = MongoParamRef.of('a', { codecId: 'cipherstash/string@1' });
    const b = MongoParamRef.of(42, { codecId: 'pg/text@1' });
    const c = MongoParamRef.of(true);
    const tree = {
      filter: { email: a, age: { $gt: b } },
      list: [c, { unrelated: 'literal' }],
    };
    const result = [...flattenMongoParamRefs(tree)];
    expect(result).toEqual([a, b, c]);
  });

  it('entries() yields one entry per MongoParamRef in walk order', () => {
    const a = MongoParamRef.of('alice', { codecId: 'cipherstash/string@1' });
    const b = MongoParamRef.of('bob', { codecId: 'cipherstash/string@1' });
    const c = MongoParamRef.of('plain', { codecId: 'pg/text@1' });
    const command = { documents: [{ email: a }, { email: b }, { tag: c }] };
    const mutator = createMongoParamRefMutator(command);
    const entries = [...mutator.entries()];
    expect(entries).toHaveLength(3);
    expect(entries[0]?.value).toBe('alice');
    expect(entries[0]?.codecId).toBe('cipherstash/string@1');
    expect(entries[2]?.codecId).toBe('pg/text@1');
  });

  it('replaceValue / replaceValues update entries() view in subsequent walks', () => {
    const a = MongoParamRef.of('alice', { codecId: 'cipherstash/string@1' });
    const b = MongoParamRef.of('bob', { codecId: 'cipherstash/string@1' });
    const command = { documents: [{ email: a }, { email: b }] };
    const mutator = createMongoParamRefMutator(command);

    const allEntries = [...mutator.entries()];
    const first = allEntries[0]!;
    const second = allEntries[1]!;
    if (first.codecId === 'cipherstash/string@1') {
      mutator.replaceValue(first.ref, 'cipher:alice');
    }
    mutator.replaceValues([{ ref: second.ref, newValue: 'cipher:bob' }]);

    const after = [...mutator.entries()];
    expect(after.map((e) => e.value)).toEqual(['cipher:alice', 'cipher:bob']);
  });

  it('handles trees with no MongoParamRefs (returns empty walk)', () => {
    const command = { documents: [{ email: 'literal' }] };
    const mutator = createMongoParamRefMutator(command);
    expect([...mutator.entries()]).toEqual([]);
  });
});
