/**
 * BetterAuth database adapter over prisma-next contract-typed collections.
 *
 * `prismaNextAdapter(db)` wires BetterAuth's stringly-typed persistence
 * interface (`model: 'session'`, `where: [{ field: 'userId', … }]`) onto
 * the typed ORM collections of the `better-auth` contract space: every
 * value crosses the seam through contract codecs, every model/field/
 * operator is resolved against the shipped contract before anything
 * reaches SQL, and unknown surfaces fail fast with a
 * {@link PrismaNextAdapterError} naming the offender.
 *
 * `consumeOne`, `incrementOne`, native `join`, and `transaction` support
 * are intentionally not configured yet; the factory's built-in fallbacks
 * apply in the meantime and the config is honest about it
 * (`transaction: false`).
 */
import { blindCast } from '@prisma-next/utils/casts';
import { type AdapterFactory, type CleanedWhere, createAdapterFactory } from 'better-auth/adapters';
import type { BetterAuthOptions } from 'better-auth/types';
import type { AdapterCollection, AdapterRow, BetterAuthDb } from './db-surface';
import { PrismaNextAdapterError } from './errors';
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

export function prismaNextAdapter(db: BetterAuthDb): AdapterFactory<BetterAuthOptions> {
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

  return createAdapterFactory({
    config: {
      adapterId: 'prisma-next',
      adapterName: 'Prisma Next Adapter',
      supportsNumericIds: false,
      supportsDates: true,
      supportsBooleans: true,
      supportsJSON: true,
      // Transaction support arrives with the native consumeOne wiring; until
      // then the factory executes operations sequentially — honestly declared.
      transaction: false,
    },
    adapter: () => ({
      async create({ model, data, select }) {
        const resolved = resolveModel(model);
        assertKnownFields(model, resolved.spaceModel, data);
        const row = await resolved.collection.create(data);
        return widenRow(projectRow(row, model, resolved.spaceModel, select));
      },

      async findOne({ model, where, select }) {
        const resolved = resolveModel(model);
        const row = await scopeToWhere(resolved, model, where).first();
        if (row === null) {
          return null;
        }
        return widenRow(projectRow(row, model, resolved.spaceModel, select));
      },

      async findMany({ model, where, limit, sortBy, offset, select }) {
        const resolved = resolveModel(model);
        let scoped = scopeToWhere(resolved, model, where);
        if (sortBy !== undefined) {
          scoped = scoped.orderBy(buildOrderBySelector(sortBy, model, resolved.spaceModel));
        }
        if (offset !== undefined && offset > 0) {
          scoped = scoped.skip(offset);
        }
        scoped = scoped.take(limit);
        const rows = await scoped.all();
        return rows.map((row) => widenRow(projectRow(row, model, resolved.spaceModel, select)));
      },

      async update({ model, where, update }) {
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
        const resolved = resolveModel(model);
        await scopeToWhere(resolved, model, where).delete();
      },

      async deleteMany({ model, where }) {
        const resolved = resolveModel(model);
        return scopeToWhere(resolved, model, where).deleteCount();
      },

      async count({ model, where }) {
        const resolved = resolveModel(model);
        const stats = await scopeToWhere(resolved, model, where).aggregate((aggregate) => ({
          count: aggregate.count(),
        }));
        return stats.count;
      },
    }),
  });
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
