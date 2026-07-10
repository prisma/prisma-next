/**
 * Type-level properties of the BetterAuth adapter seam:
 *
 * 1. Model-map exhaustiveness: `BETTER_AUTH_MODEL_BY_SPACE_MODEL` is
 *    `satisfies Record<SpaceModelName, string>`-bound in the source, so the
 *    compile failure lives there; these assertions additionally pin the
 *    mapping's value set so a rename is caught as a type error here.
 *
 * 2. `BetterAuthDb` accepts an app's ordinary prisma-next client: a
 *    `PostgresClient` over a contract whose aggregate includes the
 *    better-auth space (the space's own contract stands in as the minimal
 *    such aggregate) is assignable without ceremony.
 */

import type { PostgresClient } from '@prisma-next/postgres/runtime';
import { expectTypeOf, test } from 'vitest';
import type {
  BETTER_AUTH_MODEL_BY_SPACE_MODEL,
  BetterAuthDb,
  BetterAuthModelName,
  SpaceModelName,
} from '../src/adapter/index';
import type { Contract } from '../src/contract/contract.d';

test('every space model has a BetterAuth model mapping and vice versa', () => {
  expectTypeOf<keyof typeof BETTER_AUTH_MODEL_BY_SPACE_MODEL>().toEqualTypeOf<SpaceModelName>();
  expectTypeOf<BetterAuthModelName>().toEqualTypeOf<
    'user' | 'session' | 'account' | 'verification'
  >();
  expectTypeOf<SpaceModelName>().toEqualTypeOf<'User' | 'Session' | 'Account' | 'Verification'>();
});

test('an ordinary prisma-next PostgresClient satisfies BetterAuthDb', () => {
  expectTypeOf<PostgresClient<Contract>>().toExtend<BetterAuthDb>();
});
