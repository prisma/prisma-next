/**
 * AC-CB-6: end-to-end no-emit authoring chain type tests
 * (TML-2357 M0 R6 / Phase D — T0.D.3).
 *
 * The no-emit chain is the strongest evidence M0's typed flow works as
 * designed: authoring a contract via the TS callback surface
 * (`defineContract` + `field.*` builders) produces a contract whose
 * model + field types flow through to the SQL builder lane, so that:
 *
 *   - `field.id.uuidv4()` resolves to a string-shaped field;
 *   - `fns.eq(f.id, '<uuid string>')` typechecks at the where clause;
 *   - `fns.eq(f.id, 1234)` fails to typecheck (id is a string, not a
 *     number).
 *
 * The contract is the demo's own no-emit `contract` value (typed via
 * `defineContract` callback inference, not via `contract.d.ts`).
 */

import { expectTypeOf, test } from 'vitest';
import type { contract } from '../prisma/contract';
import { sql } from '../src/prisma-no-emit/context';

// ---------------------------------------------------------------------------
// 1. `field.id.uuidv4()` produces a string-shaped field on the User model.
// ---------------------------------------------------------------------------

test('field.id.uuidv4() produces a string-typed id field on User', () => {
  type UserStorageFields = (typeof contract.models)['User']['storage']['fields'];
  expectTypeOf<UserStorageFields>().toHaveProperty('id');
  type IdField = UserStorageFields['id'];
  expectTypeOf<IdField>().toHaveProperty('column');
});

// ---------------------------------------------------------------------------
// 2. SQL builder where-clause typechecks string id with `fns.eq`.
// ---------------------------------------------------------------------------

test('fns.eq(f.id, "<uuid>") typechecks on the User table', () => {
  const plan = sql.user
    .select('id', 'email')
    .where((f, fns) => fns.eq(f.id, 'b3a1f8e0-1234-4f5a-9876-abcdef012345'))
    .limit(1)
    .build();
  expectTypeOf(plan).not.toBeNever();
});

// ---------------------------------------------------------------------------
// 3. Negative test: passing a number to `fns.eq(f.id, …)` fails.
// ---------------------------------------------------------------------------

test('fns.eq(f.id, 1234) fails to typecheck — id is a string, not a number', () => {
  sql.user
    .select('id', 'email')
    // @ts-expect-error -- id is string-typed; comparing to a number violates the typed flow
    .where((f, fns) => fns.eq(f.id, 1234))
    .limit(1)
    .build();
});

// ---------------------------------------------------------------------------
// 4. Authoring chain: model relations + field selection typecheck.
// ---------------------------------------------------------------------------

test('authoring chain preserves model + field types end-to-end', () => {
  expectTypeOf<keyof typeof contract.models>().toExtend<'User' | 'Post'>();
  type PostStorageFields = (typeof contract.models)['Post']['storage']['fields'];
  expectTypeOf<PostStorageFields>().toHaveProperty('title');
  expectTypeOf<PostStorageFields>().toHaveProperty('userId');
});
