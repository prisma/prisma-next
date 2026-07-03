/**
 * End-to-end type-test for the native list ops (`has`, `arrayContains`,
 * `containedBy`, `overlaps`, `length`, `index`), driven through the REAL emitted
 * contract and
 * the REAL sql-builder `.where((f, fns) => …)` / `.select(alias, (f, fns) => …)`
 * surfaces — no synthetic scope. At the type level:
 *
 * - `f.tags` (a `many: true` column) surfaces as a list receiver, so each op
 *   type-checks and yields the declared return expression.
 * - a scalar column receiver (`f.id`) is a compile error.
 * - a wrong-typed element/array/index is a compile error.
 *
 * Each op is the postgres adapter's registry op (`descriptor-meta.ts`),
 * surfaced verbatim by `DeriveExtFunctions` from the contract's
 * `queryOperationTypes`.
 */

import type { BooleanCodecType, Db, Expression } from '@prisma-next/sql-builder/types';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../sql-orm-client/fixtures/scalar-lists/generated/contract';

declare const db: Db<Contract>;

test('has membership resolves over a list column in a where-callback body', () => {
  db.public.item.select('id').where((f, fns) => {
    const result = fns.has(f.tags, 'react');
    expectTypeOf(result).toExtend<Expression<BooleanCodecType>>();
    return result;
  });
  // an Int[] list accepts an int element
  db.public.item.select('id').where((f, fns) => fns.has(f.scores, 1));
});

test('has rejects a scalar receiver', () => {
  db.public.item.select('id').where((f, fns) =>
    // @ts-expect-error -- id is a scalar column, not a list receiver
    fns.has(f.id, 1),
  );
});

test('has rejects a wrong-typed element', () => {
  db.public.item.select('id').where((f, fns) =>
    // @ts-expect-error -- tags is a text list; the element must be a string
    fns.has(f.tags, 5),
  );
});

test('array filters (arrayContains/containedBy/overlaps) resolve over a list column', () => {
  db.public.item.select('id').where((f, fns) => {
    const contained = fns.containedBy(f.tags, ['react', 'vue']);
    expectTypeOf(contained).toExtend<Expression<BooleanCodecType>>();
    const superset = fns.arrayContains(f.tags, ['react']);
    expectTypeOf(superset).toExtend<Expression<BooleanCodecType>>();
    return fns.and(
      contained,
      superset,
      fns.overlaps(f.tags, ['svelte']),
      // an Int[] list accepts an int array operand
      fns.containedBy(f.scores, [1, 2]),
      fns.arrayContains(f.scores, [1]),
      // a list-typed operand (another list column) is accepted
      fns.overlaps(f.tags, f.tags),
      fns.arrayContains(f.tags, f.tags),
    );
  });
});

test('array filters reject a scalar receiver', () => {
  db.public.item.select('id').where((f, fns) =>
    // @ts-expect-error -- id is a scalar column, not a list receiver
    fns.overlaps(f.id, [1]),
  );
  db.public.item.select('id').where((f, fns) =>
    // @ts-expect-error -- id is a scalar column, not a list receiver
    fns.arrayContains(f.id, [1]),
  );
});

test('array filters reject a wrong-typed array element', () => {
  db.public.item.select('id').where((f, fns) =>
    // @ts-expect-error -- tags is a text list; the array elements must be strings
    fns.containedBy(f.tags, [5]),
  );
  db.public.item.select('id').where((f, fns) =>
    // @ts-expect-error -- tags is a text list; the array elements must be strings
    fns.arrayContains(f.tags, [5]),
  );
});

test('length yields a non-null int over a list column', () => {
  db.public.item.select('n', (f, fns) => {
    const len = fns.length(f.tags);
    expectTypeOf(len).toExtend<Expression<{ codecId: 'pg/int4@1'; nullable: false }>>();
    return len;
  });
});

test('length rejects a scalar receiver', () => {
  db.public.item.select('n', (f, fns) =>
    // @ts-expect-error -- id is a scalar column, not a list receiver
    fns.length(f.id),
  );
});

test('index yields the nullable element codec over a list column', () => {
  db.public.item.select('first', (f, fns) => {
    const firstTag = fns.index(f.tags, 1);
    expectTypeOf(firstTag).toExtend<Expression<{ codecId: 'pg/text@1'; nullable: true }>>();
    return firstTag;
  });
  db.public.item.select('firstScore', (f, fns) => {
    const firstScore = fns.index(f.scores, 1);
    expectTypeOf(firstScore).toExtend<Expression<{ codecId: 'pg/int4@1'; nullable: true }>>();
    return firstScore;
  });
});

test('index rejects a scalar receiver', () => {
  db.public.item.select('first', (f, fns) =>
    // @ts-expect-error -- id is a scalar column, not a list receiver
    fns.index(f.id, 1),
  );
});

test('index rejects a non-int index', () => {
  db.public.item.select('first', (f, fns) =>
    // @ts-expect-error -- the index must be an integer expression, not a string
    fns.index(f.scores, 'x'),
  );
});
