/**
 * BetterAuth database adapter over prisma-next contract-typed collections.
 *
 * `prismaNextAdapter(db)` wires BetterAuth's stringly-typed persistence
 * interface (`model: 'session'`, `where: [{ field: 'userId', … }]`) onto
 * the typed ORM collections of the `better-auth` contract space: every
 * value crosses the seam through contract codecs, every model/field/
 * operator/join target is resolved against the shipped contract before
 * anything reaches SQL, and unknown surfaces fail fast with a
 * {@link PrismaNextAdapterError} naming the offender.
 *
 * - `consumeOne` is native: `Collection.delete()` is the atomic
 *   find-first + identity-narrowed `DELETE … RETURNING` primitive, so two
 *   concurrent consumers of the same row can never both receive it.
 * - `transaction` is real: the config opens `db.transaction(...)` and
 *   rebinds the adapter to the transaction scope's collections, so a
 *   failing flow rolls back atomically.
 * - `join` on `findOne`/`findMany` runs through `Collection.include()`
 *   over the space's navigable relations; a join target the contract
 *   cannot express is a typed error, never a silent degradation.
 */
import { blindCast } from '@prisma-next/utils/casts';
import {
  type AdapterFactory,
  type AdapterFactoryConfig,
  type CleanedWhere,
  type CustomAdapter,
  createAdapterFactory,
  type JoinConfig,
} from 'better-auth/adapters';
import type { BetterAuthOptions } from 'better-auth/types';
import type {
  AdapterCollection,
  AdapterIncludeRefinement,
  AdapterRow,
  BetterAuthDb,
  BetterAuthDbCollections,
} from './db-surface';
import { PrismaNextAdapterError } from './errors';
import { resolveJoinRelations } from './join';
import {
  assertKnownField,
  assertKnownFields,
  resolveSpaceModel,
  type SpaceModelName,
} from './model-map';
import { buildOrderBySelector, buildWhereExpression } from './where';

interface ResolvedModel {
  readonly spaceModel: SpaceModelName;
  readonly collection: AdapterCollection;
}

function projectRow(
  row: AdapterRow,
  model: string,
  spaceModel: SpaceModelName,
  select: readonly string[] | undefined,
): AdapterRow {
  if (select === undefined || select.length === 0) {
    return row;
  }
  for (const field of select) {
    assertKnownField(model, spaceModel, field);
  }
  return Object.fromEntries(Object.entries(row).filter(([key]) => select.includes(key)));
}

/**
 * BetterAuth's `CustomAdapter` methods are generic in a caller-chosen `T`
 * the adapter cannot know or verify; every reference adapter performs this
 * widening. The rows produced here come from the contract-typed collections,
 * so their runtime shape is the model row BetterAuth expects.
 */
function widenRow<T>(row: AdapterRow): T {
  return blindCast<
    T,
    "CustomAdapter's T is caller-chosen and unverifiable; the row comes from the contract-typed collection for the resolved model"
  >(row);
}

/**
 * Applies a row cap to a nested include collection. The structural
 * `include` signature types the refinement parameter as `never` (see
 * `AdapterCollection.include`); the nested collection's real surface
 * carries `take()`, narrowed back here at the single call seam.
 */
function capIncludedRows(related: unknown, limit: number): unknown {
  return blindCast<
    AdapterIncludeRefinement,
    "the ORM's include refinement receives the nested Collection, which exposes take(); the structural surface types it unknown for assignability with the deep-generic signature"
  >(related).take(limit);
}

function asRecord(value: unknown, model: string): AdapterRow {
  if (typeof value !== 'object' || value === null) {
    throw new PrismaNextAdapterError(
      'INVALID_OPERATOR_VALUE',
      `Update payload for model "${model}" must be an object.`,
      { model },
    );
  }
  return Object.fromEntries(Object.entries(value));
}

function buildCustomAdapter(db: BetterAuthDbCollections): CustomAdapter {
  const resolveModel = (model: string): ResolvedModel => {
    const spaceModel = resolveSpaceModel(model);
    return { spaceModel, collection: db.orm.public[spaceModel] };
  };

  const scopeToWhere = (
    { spaceModel, collection }: ResolvedModel,
    model: string,
    where: readonly CleanedWhere[] | undefined,
  ): AdapterCollection => {
    if (where === undefined || where.length === 0) {
      return collection;
    }
    return collection.where((accessor) => {
      const expression = buildWhereExpression(where, accessor, model, spaceModel);
      if (expression === undefined) {
        throw new PrismaNextAdapterError(
          'INVALID_OPERATOR_VALUE',
          `Empty where clause list for model "${model}" cannot narrow a query.`,
          { model },
        );
      }
      return expression;
    });
  };

  const applyJoins = (
    scoped: AdapterCollection,
    model: string,
    spaceModel: SpaceModelName,
    join: JoinConfig | undefined,
  ): AdapterCollection => {
    if (join === undefined) {
      return scoped;
    }
    let joined = scoped;
    for (const { relationName, limit } of resolveJoinRelations(model, spaceModel, join)) {
      joined =
        limit === undefined
          ? joined.include(relationName)
          : joined.include(relationName, (related) => capIncludedRows(related, limit));
    }
    return joined;
  };

  // BetterAuth ≥1.6.17 standardizes the singular write methods as no-ops
  // when called with an empty/absent `where`: `update`/`consumeOne` return
  // null, `delete` does nothing. The factory guards its own `update` path
  // (v1.6.23) but forwards `delete`/`consumeOne` unguarded, and
  // `scopeToWhere` would otherwise return the unscoped collection — an
  // accidental whole-table write.
  const isEmptyWhere = (where: readonly CleanedWhere[] | undefined): boolean =>
    where === undefined || where.length === 0;

  return {
    async create({ model, data, select }) {
      const resolved = resolveModel(model);
      assertKnownFields(model, resolved.spaceModel, data);
      const row = await resolved.collection.create(data);
      return widenRow(projectRow(row, model, resolved.spaceModel, select));
    },

    async findOne({ model, where, select, join }) {
      const resolved = resolveModel(model);
      const scoped = applyJoins(
        scopeToWhere(resolved, model, where),
        model,
        resolved.spaceModel,
        join,
      );
      const row = await scoped.first();
      if (row === null) {
        return null;
      }
      // With a native join the raw row must reach the factory intact — it
      // reads the joined key off the row; select filtering happens in the
      // factory's own output transform.
      return widenRow(
        join === undefined ? projectRow(row, model, resolved.spaceModel, select) : row,
      );
    },

    async findMany({ model, where, limit, sortBy, offset, select, join }) {
      const resolved = resolveModel(model);
      let scoped = applyJoins(
        scopeToWhere(resolved, model, where),
        model,
        resolved.spaceModel,
        join,
      );
      if (sortBy !== undefined) {
        scoped = scoped.orderBy(buildOrderBySelector(sortBy, model, resolved.spaceModel));
      }
      if (offset !== undefined && offset > 0) {
        scoped = scoped.skip(offset);
      }
      scoped = scoped.take(limit);
      const rows = await scoped.all();
      return rows.map((row) =>
        widenRow(join === undefined ? projectRow(row, model, resolved.spaceModel, select) : row),
      );
    },

    async update({ model, where, update }) {
      if (isEmptyWhere(where)) {
        return null;
      }
      const resolved = resolveModel(model);
      const data = asRecord(update, model);
      assertKnownFields(model, resolved.spaceModel, data);
      const updated = await scopeToWhere(resolved, model, where).update(data);
      if (updated === null) {
        return null;
      }
      return widenRow(updated);
    },

    async updateMany({ model, where, update }) {
      const resolved = resolveModel(model);
      assertKnownFields(model, resolved.spaceModel, update);
      return scopeToWhere(resolved, model, where).updateCount(update);
    },

    async delete({ model, where }) {
      if (isEmptyWhere(where)) {
        return;
      }
      const resolved = resolveModel(model);
      await scopeToWhere(resolved, model, where).delete();
    },

    async deleteMany({ model, where }) {
      const resolved = resolveModel(model);
      return scopeToWhere(resolved, model, where).deleteCount();
    },

    async consumeOne({ model, where }) {
      if (isEmptyWhere(where)) {
        return null;
      }
      const resolved = resolveModel(model);
      const consumed = await scopeToWhere(resolved, model, where).delete();
      if (consumed === null) {
        return null;
      }
      return widenRow(consumed);
    },

    async count({ model, where }) {
      const resolved = resolveModel(model);
      const stats = await scopeToWhere(resolved, model, where).aggregate((aggregate) => ({
        count: aggregate.count(),
      }));
      return stats.count;
    },
  };
}

const ADAPTER_CONFIG_BASE = {
  adapterId: 'prisma-next',
  adapterName: 'Prisma Next Adapter',
  supportsNumericIds: false,
  supportsDates: true,
  supportsBooleans: true,
  supportsJSON: true,
} as const satisfies Partial<AdapterFactoryConfig>;

export function prismaNextAdapter(db: BetterAuthDb): AdapterFactory<BetterAuthOptions> {
  // The transaction config rebinds the adapter to the transaction scope's
  // collections via a nested factory instance (reference-adapter pattern),
  // which needs the auth options the outer factory was created with.
  let lazyOptions: BetterAuthOptions = {};

  const factory = createAdapterFactory({
    config: {
      ...ADAPTER_CONFIG_BASE,
      transaction: (callback) =>
        db.transaction((tx) => {
          const transactionAdapter = createAdapterFactory({
            config: {
              ...ADAPTER_CONFIG_BASE,
              transaction: false,
            },
            adapter: () => buildCustomAdapter(tx),
          })(lazyOptions);
          return callback(transactionAdapter);
        }),
    },
    adapter: () => buildCustomAdapter(db),
  });

  return (options) => {
    lazyOptions = options;
    return factory(options);
  };
}
