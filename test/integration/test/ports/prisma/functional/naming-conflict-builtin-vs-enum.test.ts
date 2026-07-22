import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/naming-conflict-builtin-vs-enum/generated/contract';
import contractJson from '../../_fixtures/naming-conflict-builtin-vs-enum/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/naming-conflict/built-in-types-vs-enum
// (postgres matrix entry).
//
// Upstream tests 63 enum names that conflict with Prisma's generated built-in
// TypeScript type names (Keys, Promise, Result, Union, …). prisma-next has no
// client-side code generation, so naming conflicts with generated types cannot
// arise. Four representative names (Promise, Result, Union, Keys) cover the
// observable runtime behavior: storing and reading an enum value whose type
// name clashes with common JS/TS built-in names.
//
// The `expectTypeOf(data.value).toEqualTypeOf<'ONE'|'TWO'>()` assertion from
// upstream is a compile-time type check — non-portable (no generated
// PrismaClient types in prisma-next). Runtime value assertions are ported.

function withBuiltinVsEnum(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/naming-conflict-builtin-vs-enum', () => {
  it(
    'allows to create enum named Promise with conflicting name',
    () =>
      withBuiltinVsEnum(async ({ db }) => {
        await db.public.EnumHolderPromise.create({ value: 'ONE' });
        const data = await db.public.EnumHolderPromise.all().firstOrThrow();

        expect(data.value).toBe('ONE');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'allows to create enum named Result with conflicting name',
    () =>
      withBuiltinVsEnum(async ({ db }) => {
        await db.public.EnumHolderResult.create({ value: 'ONE' });
        const data = await db.public.EnumHolderResult.all().firstOrThrow();

        expect(data.value).toBe('ONE');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'allows to create enum named Union with conflicting name',
    () =>
      withBuiltinVsEnum(async ({ db }) => {
        await db.public.EnumHolderUnion.create({ value: 'ONE' });
        const data = await db.public.EnumHolderUnion.all().firstOrThrow();

        expect(data.value).toBe('ONE');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'allows to create enum named Keys with conflicting name',
    () =>
      withBuiltinVsEnum(async ({ db }) => {
        await db.public.EnumHolderKeys.create({ value: 'ONE' });
        const data = await db.public.EnumHolderKeys.all().firstOrThrow();

        expect(data.value).toBe('ONE');
      }),
    timeouts.spinUpPpgDev,
  );
});
