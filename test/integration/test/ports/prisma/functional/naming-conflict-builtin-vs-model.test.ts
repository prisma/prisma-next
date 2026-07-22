import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/naming-conflict-builtin-vs-model/generated/contract';
import contractJson from '../../_fixtures/naming-conflict-builtin-vs-model/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/naming-conflict/built-in-types-vs-model
// (postgres matrix entry).
//
// Upstream tests 63 model names that conflict with Prisma's generated built-in
// TypeScript type names (Keys, Promise, Result, Union, …). prisma-next has no
// client-side code generation, so naming conflicts with generated types cannot
// arise. Four representative names (Promise, Result, Union, Keys) cover the
// observable runtime behavior: creating a model whose name clashes with common
// JS/TS built-in names and querying it via a relation.
//
// Non-portable upstream assertions:
//   - `expectTypeOf(result).not.toBeAny()` — compile-time type check only
//   - `expectTypeOf(result).toMatchTypeOf<{id: string; isUserProvidedType: boolean}>()` — same
// These are Prisma-client type-level tests with no runtime equivalent.

function withBuiltinVsModel(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/naming-conflict-builtin-vs-model', () => {
  it(
    'allows to use model named Promise',
    () =>
      withBuiltinVsModel(async ({ db }) => {
        const { id } = await db.public.Promise.create({ isUserProvidedType: true });
        await db.public.RelationHolderPromise.create({
          model: (m) => m.connect({ id }),
        });

        const result = await db.public.Promise.all().firstOrThrow();

        expect(result).toEqual({
          id: expect.any(String),
          isUserProvidedType: true,
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'allows to use model named Promise via relation',
    () =>
      withBuiltinVsModel(async ({ db }) => {
        const { id } = await db.public.Promise.create({ isUserProvidedType: true });
        await db.public.RelationHolderPromise.create({
          model: (m) => m.connect({ id }),
        });

        const result = await db.public.RelationHolderPromise.include('model').all().firstOrThrow();

        expect(result.model).toEqual({
          id: expect.any(String),
          isUserProvidedType: true,
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'allows to use model named Result',
    () =>
      withBuiltinVsModel(async ({ db }) => {
        const { id } = await db.public.Result.create({ isUserProvidedType: true });
        await db.public.RelationHolderResult.create({
          model: (m) => m.connect({ id }),
        });

        const result = await db.public.Result.all().firstOrThrow();

        expect(result).toEqual({
          id: expect.any(String),
          isUserProvidedType: true,
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'allows to use model named Result via relation',
    () =>
      withBuiltinVsModel(async ({ db }) => {
        const { id } = await db.public.Result.create({ isUserProvidedType: true });
        await db.public.RelationHolderResult.create({
          model: (m) => m.connect({ id }),
        });

        const result = await db.public.RelationHolderResult.include('model').all().firstOrThrow();

        expect(result.model).toEqual({
          id: expect.any(String),
          isUserProvidedType: true,
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'allows to use model named Union',
    () =>
      withBuiltinVsModel(async ({ db }) => {
        const { id } = await db.public.Union.create({ isUserProvidedType: true });
        await db.public.RelationHolderUnion.create({
          model: (m) => m.connect({ id }),
        });

        const result = await db.public.Union.all().firstOrThrow();

        expect(result).toEqual({
          id: expect.any(String),
          isUserProvidedType: true,
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'allows to use model named Union via relation',
    () =>
      withBuiltinVsModel(async ({ db }) => {
        const { id } = await db.public.Union.create({ isUserProvidedType: true });
        await db.public.RelationHolderUnion.create({
          model: (m) => m.connect({ id }),
        });

        const result = await db.public.RelationHolderUnion.include('model').all().firstOrThrow();

        expect(result.model).toEqual({
          id: expect.any(String),
          isUserProvidedType: true,
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'allows to use model named Keys',
    () =>
      withBuiltinVsModel(async ({ db }) => {
        const { id } = await db.public.Keys.create({ isUserProvidedType: true });
        await db.public.RelationHolderKeys.create({
          model: (m) => m.connect({ id }),
        });

        const result = await db.public.Keys.all().firstOrThrow();

        expect(result).toEqual({
          id: expect.any(String),
          isUserProvidedType: true,
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'allows to use model named Keys via relation',
    () =>
      withBuiltinVsModel(async ({ db }) => {
        const { id } = await db.public.Keys.create({ isUserProvidedType: true });
        await db.public.RelationHolderKeys.create({
          model: (m) => m.connect({ id }),
        });

        const result = await db.public.RelationHolderKeys.include('model').all().firstOrThrow();

        expect(result.model).toEqual({
          id: expect.any(String),
          isUserProvidedType: true,
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
