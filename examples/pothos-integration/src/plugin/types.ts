import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Collection } from '@prisma-next/sql-orm-client';

/**
 * Public surface of the per-model accessor object the user passes to the
 * builder via `prismaNext.db`. Concretely this is the object returned by
 * `orm({ runtime, context })`, indexed by model name.
 */
export type PrismaNextDb<TContract extends Contract<SqlStorage>> = {
  readonly [ModelName in keyof ExtractModels<TContract> & string]: Collection<
    TContract,
    ModelName & string
  >;
};

type ExtractModels<TContract> = TContract extends { readonly models: infer M } ? M : never;

/**
 * Options the user passes to `new SchemaBuilder({ prismaNext: ... })`.
 *
 * `db` is the orm client (per-model collection accessor).
 * `contract` is the typed Contract (from `validateContract<Contract>(json)` or the
 * authoring-time `defineContract` output).
 */
export interface PrismaNextPluginOptions<TContract extends Contract<SqlStorage>> {
  readonly db: PrismaNextDb<TContract>;
  readonly contract: TContract;
}

/**
 * The first argument passed to a `t.prismaField` resolver: the prepared
 * Collection with the auto-include selection already applied based on
 * the GraphQL query. The user chains an entry-point method:
 *
 *     resolve: (collection, _root, _args, ctx) =>
 *       collection.where({ id: ctx.userId }).all().firstOrThrow()
 */
export type PreparedCollection<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = Collection<TContract, ModelName>;

/**
 * Names of the models declared in the contract.
 */
export type PrismaNextModelName<TContract> = TContract extends {
  readonly models: infer M;
}
  ? keyof M & string
  : never;

/**
 * Metadata keys stored on Pothos type/field configs so the auto-include
 * walker and resolve wrapper can identify prisma-next-backed nodes.
 *
 * These are plain string keys (not symbols) so they survive Pothos's
 * field-config copying and end up on the resulting GraphQL field's
 * `extensions` map.
 */
export const PRISMA_NEXT_MODEL = 'pothosPrismaNextModel';
export const PRISMA_NEXT_SELECT_FIELD = 'pothosPrismaNextSelectField';
export const PRISMA_NEXT_RELATION = 'pothosPrismaNextRelation';
export const PRISMA_NEXT_RELATION_COUNT = 'pothosPrismaNextRelationCount';
export const PRISMA_NEXT_PREPARED = 'pothosPrismaNextPrepared';
