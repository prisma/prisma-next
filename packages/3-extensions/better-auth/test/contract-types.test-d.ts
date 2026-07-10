/**
 * Type-level assertions over the emitted `contract.d.ts`: the four
 * BetterAuth core models are exposed with their navigable relations and
 * unique constraints, and the pack satisfies the `extensionPacks` config
 * contract. Validated by `pnpm typecheck` (the package tsconfig includes
 * `test/`).
 */

import type { ControlExtensionDescriptor } from '@prisma-next/framework-components/control';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../src/contract/contract.d';
import betterAuthPack from '../src/exports/pack';

type PublicModels = Contract['domain']['namespaces']['public']['models'];
type PublicTables = Contract['storage']['namespaces']['public']['entries']['table'];

test('betterAuthPack is a ControlExtensionDescriptor<sql, postgres>', () => {
  expectTypeOf(betterAuthPack).toExtend<ControlExtensionDescriptor<'sql', 'postgres'>>();
});

test('the contract exposes the four BetterAuth core models', () => {
  expectTypeOf<keyof PublicModels>().toEqualTypeOf<
    'User' | 'Session' | 'Account' | 'Verification'
  >();
  expectTypeOf<keyof PublicTables>().toEqualTypeOf<
    'user' | 'session' | 'account' | 'verification'
  >();
});

test('Session.user and Account.user are navigable N:1 relations onto User', () => {
  expectTypeOf<
    PublicModels['Session']['relations']['user']['to']['model']
  >().toEqualTypeOf<'User'>();
  expectTypeOf<
    PublicModels['Session']['relations']['user']['cardinality']
  >().toEqualTypeOf<'N:1'>();
  expectTypeOf<PublicModels['Session']['relations']['user']['on']['localFields']>().toEqualTypeOf<
    readonly ['userId']
  >();
  expectTypeOf<
    PublicModels['Account']['relations']['user']['to']['model']
  >().toEqualTypeOf<'User'>();
  expectTypeOf<
    PublicModels['Account']['relations']['user']['cardinality']
  >().toEqualTypeOf<'N:1'>();
});

test('unique constraints are carried on user.email and session.token', () => {
  expectTypeOf<PublicTables['user']['uniques']>().toEqualTypeOf<
    readonly [{ readonly columns: readonly ['email'] }]
  >();
  expectTypeOf<PublicTables['session']['uniques']>().toEqualTypeOf<
    readonly [{ readonly columns: readonly ['token'] }]
  >();
});

test('nullable optionals stay nullable; required fields stay non-nullable', () => {
  expectTypeOf<PublicModels['User']['fields']['image']['nullable']>().toEqualTypeOf<true>();
  expectTypeOf<PublicModels['User']['fields']['email']['nullable']>().toEqualTypeOf<false>();
  expectTypeOf<
    PublicModels['Account']['fields']['accessToken']['nullable']
  >().toEqualTypeOf<true>();
  expectTypeOf<
    PublicModels['Verification']['fields']['value']['nullable']
  >().toEqualTypeOf<false>();
});
