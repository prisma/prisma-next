import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/naming-conflict-model-vs-model/generated/contract';
import contractJson from '../../_fixtures/naming-conflict-model-vs-model/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/naming-conflict/model-vs-model
// (postgres matrix entry).
//
// Upstream tests 12 conflicting model name variants (ModelUpdate, ModelDefault,
// ModelSelect, ModelInclude, ModelResult, ModelDelete, ModelUpsert, ModelAggregate,
// ModelCount, ModelPayload, ModelFieldRefs, ModelGroupBy). Each variant tests the
// same thing: that a model whose name conflicts with Prisma's generated type names
// can still be used for CRUD and includes.
//
// prisma-next model names map to plain property keys (db.public.Model /
// db.public.ModelUpdate), not generated TypeScript type names, so there is no
// naming conflict. One representative variant (ModelUpdate) covers all 12.

describe('ports/prisma/functional/naming-conflict-model-vs-model', () => {
  it(
    'allows to use models of conflicting names',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.Model.create({
          other: (other) => other.create({ name: 'Other type' }),
        });

        const value = await db.public.Model.include('other').all().firstOrThrow();

        expect(value.other).toMatchObject({ name: 'Other type' });
        expect(typeof value.other.id).toBe('string');
        expect(typeof value.other.name).toBe('string');
      }),
    timeouts.spinUpPpgDev,
  );
});
