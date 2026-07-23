import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import cascadeMapJson from './_fixture/cascade-map/generated/contract.json' with { type: 'json' };
import cascadeNoMapJson from './_fixture/cascade-nomap/generated/contract.json' with {
  type: 'json',
};
import defaultMapJson from './_fixture/default-map/generated/contract.json' with { type: 'json' };
import type { Contract as RepresentativeContract } from './_fixture/default-nomap/generated/contract';
import defaultNoMapJson from './_fixture/default-nomap/generated/contract.json' with {
  type: 'json',
};
import noactionMapJson from './_fixture/noaction-map/generated/contract.json' with { type: 'json' };
import noactionNoMapJson from './_fixture/noaction-nomap/generated/contract.json' with {
  type: 'json',
};
import restrictMapJson from './_fixture/restrict-map/generated/contract.json' with { type: 'json' };
import restrictNoMapJson from './_fixture/restrict-nomap/generated/contract.json' with {
  type: 'json',
};
import { allCategories, allJunction, allPosts } from './_shared';

// Port of prisma/prisma@a6d0155
//   packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n.ts
//   → describe('[create]') block, m:n mandatory (explicit) — SQL Databases.
//
// Scope: relationMode=foreignKeys only. relationMode=prisma matrix entries are
// non-ported — prisma-next relies on real DB foreign keys and has no
// client-side relationMode=prisma referential-action emulation. Both
// isSchemaUsingMap=false and =true are ported; @map only changes physical
// names, so the two behave identically through the domain-facing ORM API,
// matching upstream's relaxed map=true "Foreign key constraint violated"
// assertion.
//
// Every fixture variant emits the same logical models, so its `contractJson`
// is run under one representative Contract type (the DB-level FK actions that
// distinguish the variants are exercised at runtime, not in the types).
//
// [create] behaviour is referential-action-independent (the FK exists in every
// variant), so it is exercised across every action × map fixture to stay
// faithful to the matrix even though the result is the same everywhere.

const createFixtures: ReadonlyArray<{ label: string; contractJson: unknown }> = [
  { label: 'DEFAULT (no action) / map=false', contractJson: defaultNoMapJson },
  { label: 'DEFAULT (no action) / map=true', contractJson: defaultMapJson },
  { label: 'Cascade / map=false', contractJson: cascadeNoMapJson },
  { label: 'Cascade / map=true', contractJson: cascadeMapJson },
  { label: 'NoAction / map=false', contractJson: noactionNoMapJson },
  { label: 'NoAction / map=true', contractJson: noactionMapJson },
  { label: 'Restrict / map=false', contractJson: restrictNoMapJson },
  { label: 'Restrict / map=true', contractJson: restrictMapJson },
];

describe('ports/prisma/functional/relationMode-gh-m-to-n › [create]', () => {
  for (const { label, contractJson } of createFixtures) {
    describe(label, () => {
      it(
        '[create] category alone succeeds',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await db.public.CategoryManyToMany.create({ id: '1' });
            expect(await allCategories(db)).toEqual([{ id: '1', published: null }]);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[create] post alone succeeds',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await db.public.PostManyToMany.create({ id: '1' });
            expect(await allPosts(db)).toEqual([{ id: '1', published: null }]);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[create] junction with non-existing post and category id throws (foreignKeys)',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await expect(
              db.public.CategoriesOnPostsManyToMany.create({ postId: '99', categoryId: '99' }),
            ).rejects.toThrow();

            expect(await allJunction(db)).toEqual([]);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[create] nested create post → categories → category succeeds',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await db.public.PostManyToMany.create({
              id: '1',
              categories: (categories) =>
                categories.create([{ category: (category) => category.create({ id: '1-cat-a' }) }]),
            });

            expect(await allPosts(db)).toEqual([{ id: '1', published: null }]);
            expect(await allCategories(db)).toEqual([{ id: '1-cat-a', published: null }]);
            expect(await allJunction(db)).toEqual([{ categoryId: '1-cat-a', postId: '1' }]);
          }),
        timeouts.spinUpPpgDev,
      );
    });
  }
});
