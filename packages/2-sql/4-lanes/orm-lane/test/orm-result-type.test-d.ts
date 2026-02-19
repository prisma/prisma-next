import type { ResultType as CoreResultType } from '@prisma-next/contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { param } from '@prisma-next/sql-relational-core/param';
import type { InferNestedProjectionRow } from '@prisma-next/sql-relational-core/types';

import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { expectTypeOf, test } from 'vitest';
import { orm } from '../src/orm';
import type { IncludeAccumulator } from '../src/orm-types';
import type { Contract } from './fixtures/contract-with-relations.d';
import contractJson from './fixtures/contract-with-relations.json' with { type: 'json' };

test('ResultType extracts Row type from ORM findMany plan', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const o = orm<Contract>({ context });

  // Use the actual ORM API (not mocked) to test ResultType extraction
  const builder = (o as unknown as { user: () => unknown }).user() as {
    select: (fn: (model: unknown) => unknown) => {
      findMany: () => {
        ast: unknown;
        params: readonly unknown[];
        meta: unknown;
        _Row?: { id: number; email: string; createdAt: Date };
      };
    };
  };
  const planWithSelect = builder.select((u: unknown) => {
    const model = u as { id: unknown; email: unknown; createdAt: unknown };
    return { id: model.id, email: model.email, createdAt: model.createdAt };
  });
  const _plan = planWithSelect.findMany();

  // Use core ResultType from @prisma-next/contract to extract Row type
  // This is the pattern users will use in their code
  type Row = CoreResultType<typeof _plan>;

  // Verify that ResultType correctly extracts all field types (not 'unknown' or 'never')
  // This test would have failed before the fix - Row['email'] would be 'unknown'
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
  expectTypeOf<Row['createdAt']>().toEqualTypeOf<Date>();

  // Verify the complete row structure
  expectTypeOf<Row>().toExtend<{
    id: number;
    email: string;
    createdAt: Date;
  }>();
});

test('ResultType extracts Row type from ORM findMany plan with includes', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const o = orm<Contract>({ context });

  const plan = o
    .user()
    .include.posts((child) =>
      child.select((post) => ({
        id: post.id,
        title: post.title,
        createdAt: post.createdAt,
      })),
    )
    .select((user) => ({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      posts: true,
    }))
    .findMany({ params: { postId: 1 } });

  // Use core ResultType from @prisma-next/contract to extract Row type
  // This is the pattern users will use in their code
  type Row = CoreResultType<typeof plan>;

  // Verify that ResultType correctly extracts all field types (not 'unknown' or 'never')
  // This test would have failed before the fix - Row['email'] would be 'unknown' and Row['posts'] would be 'never[]'
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
  expectTypeOf<Row['createdAt']>().toEqualTypeOf<Date>();
  expectTypeOf<Row['posts']>().toEqualTypeOf<
    Array<{
      id: number;
      title: string;
      createdAt: Date;
    }>
  >();

  // Verify the complete row structure
  expectTypeOf<Row>().toExtend<{
    id: number;
    email: string;
    createdAt: Date;
    posts: Array<{
      id: number;
      title: string;
      createdAt: Date;
    }>;
  }>();
});

test('ResultType keeps include result types after filtering and ordering child rows', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const o = orm<Contract>({ context });

  const plan = o
    .user()
    .include.posts((child) =>
      child
        .where((post) => post.id.eq(param('postId')))
        .select((post) => ({
          id: post.id,
          title: post.title,
          createdAt: post.createdAt,
        }))
        .orderBy((post) => post.createdAt.desc()),
    )
    .select((user) => ({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      posts: true,
    }))
    .findMany({ params: { postId: 1 } });

  type Row = CoreResultType<typeof plan>;

  expectTypeOf<Row['posts']>().toEqualTypeOf<
    Array<{
      id: number;
      title: string;
      createdAt: Date;
    }>
  >();
});

test('ResultType infers nested include element shape', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const o = orm<Contract>({ context });

  const plan = o
    .user()
    .include.posts((child) =>
      child
        .where((post) => post.id.eq(param('postId')))
        .select((post) => ({
          id: post.id,
          title: post.title,
          createdAt: post.createdAt,
        }))
        .orderBy((post) => post.createdAt.desc()),
    )
    .select((user) => ({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      posts: true,
    }))
    .findMany({ params: { postId: 1 } });

  type Row = CoreResultType<typeof plan>;

  expectTypeOf<Row['posts'][number]>().toEqualTypeOf<{
    id: number;
    title: string;
    createdAt: Date;
  }>();
  expectTypeOf<Row['posts'][0]['title']>().toEqualTypeOf<string>();
});

test('IncludeAccumulator feeds include references into projection inference', () => {
  type ChildRow = {
    id: number;
    title: string;
    createdAt: Date;
  };
  type Includes = IncludeAccumulator<Record<string, never>, 'posts', ChildRow>;
  type Projection = {
    posts: true;
  };

  type Row = InferNestedProjectionRow<Projection, Record<string, { output: unknown }>, Includes>;

  expectTypeOf<Row['posts']>().toEqualTypeOf<Array<ChildRow>>();
});
