import type { Contract } from '@prisma-next/contract/types';
import {
  type AnnotationRegistry,
  createAnnotationRegistry,
} from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Db } from '../types/db';
import type { BuilderContext } from './builder-base';
import { TableProxyImpl } from './table-proxy-impl';

export interface SqlOptions<C extends Contract<SqlStorage>> {
  readonly context: ExecutionContext<C>;
  /**
   * Registry of middleware-contributed annotation handles that lane
   * terminals consume via the `.annotate(callback)` API. Defaults to an
   * empty registry when omitted (no middleware-contributed annotations
   * available); pass the registry assembled by the family runtime
   * (`postgres()` builds it from `options.middleware`) to surface
   * runtime-known annotations to authoring sites.
   */
  readonly annotationRegistry?: AnnotationRegistry;
}

/**
 * Constructs the typed `db.sql` surface from an `ExecutionContext` and
 * (optionally) a runtime-built `AnnotationRegistry`.
 *
 * `Registry` is a phantom type parameter the caller supplies so the
 * lane terminals' `.annotate(callback)` callback receives a structurally-
 * typed `AnnotationBuilder<K, Registry>`. The `Registry` value is not
 * inferred from `options.annotationRegistry` (the runtime registry is
 * an opaque container of `AnyAnnotationHandle`); callers project the
 * Registry shape explicitly via the type parameter, typically through
 * `postgres()` which captures the middleware tuple via `const Mw` and
 * passes `AnnotationsOf<Mw>` here.
 */
export function sql<C extends Contract<SqlStorage>, Registry = {}>(
  options: SqlOptions<C>,
): Db<C, Registry> {
  const { context } = options;
  const ctx: BuilderContext = {
    capabilities: context.contract.capabilities,
    queryOperationTypes: context.queryOperations.entries(),
    target: context.contract.target ?? 'unknown',
    storageHash: context.contract.storage.storageHash ?? 'unknown',
    applyMutationDefaults: (options) => context.applyMutationDefaults(options),
    annotationRegistry: options.annotationRegistry ?? createAnnotationRegistry(),
  };

  return new Proxy({} as Db<C, Registry>, {
    get(_target, prop: string) {
      const tables = context.contract.storage.tables;
      const table = Object.hasOwn(tables, prop) ? tables[prop] : undefined;
      if (table) {
        return new TableProxyImpl(prop, table, prop, ctx);
      }
      return undefined;
    },
  });
}
