import type { AnnotationsOf } from '@prisma-next/framework-components/runtime';
import type { createCacheMiddleware } from '@prisma-next/middleware-cache';
import { orm } from '@prisma-next/sql-orm-client';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Contract } from '../prisma/contract.d';
import { db } from '../prisma/db';
import { PostCollection, TaskCollection, UserCollection } from './collections';

const context = db.context as ExecutionContext<Contract>;

/**
 * Type-level shape of the middleware tuple supplied to `postgres(...)`
 * in `../prisma/db.ts`. We project this through `AnnotationsOf<Mw>` so
 * the orm() factory's `Registry` generic carries the same merged
 * registry shape that `db.orm` would have if we used it directly.
 *
 * The non-cache entries contribute nothing to the registry (their
 * `annotations` field is absent), so we type them as a bare
 * `{ readonly name: string }` — `AnnotationContribution<{ readonly name }>`
 * resolves to `{}` and drops out of the merged intersection.
 */
type DemoMiddlewareTuple = readonly [
  ReturnType<typeof createCacheMiddleware>,
  { readonly name: string }, // createTelemetryMiddleware()
  { readonly name: string }, // lints()
  { readonly name: string }, // budgets({...})
];

type DemoRegistry = AnnotationsOf<DemoMiddlewareTuple>;

export function createOrmClient(runtime: Runtime) {
  return orm<
    Contract,
    { User: typeof UserCollection; Post: typeof PostCollection; Task: typeof TaskCollection },
    DemoRegistry
  >({
    runtime,
    context,
    annotationRegistry: db.annotationRegistry,
    collections: {
      User: UserCollection,
      Post: PostCollection,
      Task: TaskCollection,
    },
  });
}
