/**
 * Static predicate matrix for the RLS policy helpers, mirroring Postgres:
 * SELECT/DELETE take `using` only; INSERT takes `withCheck` only; UPDATE/ALL
 * take either or both (at least one). `permissive` is not authorable on any
 * of them.
 */

import { expectTypeOf } from 'vitest';
import type { RlsPolicyHandle, RlsRoleHandle } from '../../src/exports/contract-builder';
import {
  field,
  model,
  policyAll,
  policyDelete,
  policyInsert,
  policySelect,
  policyUpdate,
  rlsEnabled,
  role,
} from '../../src/exports/contract-builder';

const intColumn = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;

const Profile = model('Profile', {
  fields: { id: field.column(intColumn).id() },
}).sql({ table: 'profile' });

const anon = role('anon');

expectTypeOf(anon).toExtend<RlsRoleHandle<'anon'>>();
expectTypeOf(anon.name).toEqualTypeOf<'anon'>();

expectTypeOf(policySelect(Profile, { name: 'p', roles: [anon], using: 'true' })).toExtend<
  RlsPolicyHandle<'select'>
>();
expectTypeOf(policyInsert(Profile, { name: 'p', roles: [anon], withCheck: 'true' })).toExtend<
  RlsPolicyHandle<'insert'>
>();
expectTypeOf(
  policyUpdate(Profile, { name: 'p', roles: [anon], using: 'true', withCheck: 'true' }),
).toExtend<RlsPolicyHandle<'update'>>();
expectTypeOf(policyDelete(Profile, { name: 'p', roles: [anon], using: 'true' })).toExtend<
  RlsPolicyHandle<'delete'>
>();
expectTypeOf(
  policyAll(Profile, { name: 'p', roles: [anon], using: 'true', withCheck: 'true' }),
).toExtend<RlsPolicyHandle<'all'>>();

// The function form receives a ref callback and is stored, not evaluated.
policySelect(Profile, { name: 'p', roles: [anon], using: ({ ref }) => `id = ${ref(Profile)}.id` });

// SELECT does not take withCheck.
// @ts-expect-error — policySelect rejects a withCheck predicate
policySelect(Profile, { name: 'p', roles: [anon], using: 'true', withCheck: 'true' });

// DELETE does not take withCheck.
// @ts-expect-error — policyDelete rejects a withCheck predicate
policyDelete(Profile, { name: 'p', roles: [anon], using: 'true', withCheck: 'true' });

// INSERT does not take using.
// @ts-expect-error — policyInsert rejects a using predicate
policyInsert(Profile, { name: 'p', roles: [anon], withCheck: 'true', using: 'true' });

// UPDATE takes using, withCheck, or both — each single-predicate form compiles.
expectTypeOf(policyUpdate(Profile, { name: 'p', roles: [anon], using: 'true' })).toExtend<
  RlsPolicyHandle<'update'>
>();
expectTypeOf(policyUpdate(Profile, { name: 'p', roles: [anon], withCheck: 'true' })).toExtend<
  RlsPolicyHandle<'update'>
>();

// ALL takes using, withCheck, or both — each single-predicate form compiles.
expectTypeOf(policyAll(Profile, { name: 'p', roles: [anon], using: 'true' })).toExtend<
  RlsPolicyHandle<'all'>
>();
expectTypeOf(policyAll(Profile, { name: 'p', roles: [anon], withCheck: 'true' })).toExtend<
  RlsPolicyHandle<'all'>
>();

// Zero predicates on UPDATE/ALL is a compile error.
// @ts-expect-error — policyUpdate requires at least one predicate
policyUpdate(Profile, { name: 'p', roles: [anon] });
// @ts-expect-error — policyAll requires at least one predicate
policyAll(Profile, { name: 'p', roles: [anon] });

// `permissive` is not authorable on any helper.
// @ts-expect-error — permissive is not an authoring input
policySelect(Profile, { name: 'p', roles: [anon], using: 'true', permissive: true });
// @ts-expect-error — permissive is not an authoring input
policyInsert(Profile, { name: 'p', roles: [anon], withCheck: 'true', permissive: true });
policyUpdate(Profile, {
  name: 'p',
  roles: [anon],
  using: 'true',
  withCheck: 'true',
  // @ts-expect-error — permissive is not an authoring input
  permissive: true,
});
// @ts-expect-error — permissive is not an authoring input
policyDelete(Profile, { name: 'p', roles: [anon], using: 'true', permissive: false });
policyAll(Profile, {
  name: 'p',
  roles: [anon],
  using: 'true',
  withCheck: 'true',
  // @ts-expect-error — permissive is not an authoring input
  permissive: true,
});

// Roles must be role handles, not bare strings.
// @ts-expect-error — roles takes RlsRoleHandle values, not strings
policySelect(Profile, { name: 'p', roles: ['anon'], using: 'true' });

// rlsEnabled takes a model handle, not a table-name string.
// @ts-expect-error — rlsEnabled takes a model handle
rlsEnabled('profile');
