/**
 * End-to-end type-test for the native list membership op `has`, driven through
 * the REAL emitted contract and the REAL sql-builder `.where((f, fns) => …)`
 * surface — no synthetic scope. Proves AC3 at the type level:
 *
 * - `f.tags` (a `many: true` column) surfaces as a list receiver, so
 *   `fns.has(f.tags, x)` type-checks and yields a boolean expression.
 * - a scalar column receiver (`f.id`) is a compile error.
 * - a wrong-typed element (`5` against a text list) is a compile error.
 *
 * `fns.has` is the postgres adapter's registry op (`descriptor-meta.ts`),
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
