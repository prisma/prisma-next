import './global-types';
import './schema-builder';
import './field-builder';
import SchemaBuilder, {
  BasePlugin,
  type PothosOutputFieldConfig,
  type SchemaTypes,
} from '@pothos/core';
import type { GraphQLFieldResolver, GraphQLResolveInfo } from 'graphql';
import { applySelectionToCollection } from './auto-include';
import {
  PRISMA_NEXT_PREPARED,
  PRISMA_NEXT_RELATION,
  PRISMA_NEXT_RELATION_COUNT,
  PRISMA_NEXT_SELECT_FIELD,
} from './types';

const pluginName = 'prismaNext';

export default pluginName;

export class PothosPrismaNextPlugin<Types extends SchemaTypes> extends BasePlugin<Types> {
  override wrapResolve(
    resolver: GraphQLFieldResolver<unknown, Types['Context'], object>,
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): GraphQLFieldResolver<unknown, Types['Context'], object> {
    const ext = (fieldConfig.extensions ?? {}) as Record<string | symbol, unknown>;

    // ---- t.prismaField: prepare a Collection from info, hand it to the user resolver
    if (ext[PRISMA_NEXT_PREPARED]) {
      const modelName = ext[PRISMA_NEXT_PREPARED] as string;
      return (parent, args, context, info) => {
        const opts = this.builder.options.prismaNext;
        const baseCollection = (opts.db as unknown as Record<string, unknown>)[modelName];
        if (!baseCollection) {
          throw new Error(
            `[pothos-prisma-next] No collection registered for model '${modelName}' on builder.options.prismaNext.db. ` +
              'Make sure the contract has this model and the orm() client was constructed with it.',
          );
        }
        const prepared = applySelectionToCollection(
          baseCollection as never,
          info,
          this.buildCache as never,
        );
        return (
          resolver as unknown as (
            collection: unknown,
            parent: unknown,
            args: unknown,
            context: unknown,
            info: GraphQLResolveInfo,
          ) => unknown
        )(prepared, parent, args, context, info);
      };
    }

    // ---- t.relation / t.relationCount: read the value from the (possibly reshaped) parent
    const relation = ext[PRISMA_NEXT_RELATION] as { relationName: string } | undefined;
    if (relation) {
      return (parent, _args, _context, info) => {
        // M1 single-relation case: the walker emits a plain
        // `.include(rel, ...)`, which writes the result onto
        // `parent[relation.relationName]`. The GraphQL field name (which
        // is `info.fieldName` here) defaults to the relation name unless
        // the user aliased it — M2 will introduce per-alias reshape.
        const key = info.fieldName;
        const value =
          readReshapedField(parent as Record<string, unknown>, key) ??
          (parent as Record<string, unknown>)[relation.relationName];
        if (value === undefined) {
          throw new Error(
            `[pothos-prisma-next] Relation '${info.parentType.name}.${info.fieldName}' was reached from a parent ` +
              'not loaded by t.prismaField. Use t.prismaField as the entry point so the auto-include walker can preload ' +
              'this relation. Lazy fallback loading is not supported in this demo.',
          );
        }
        return value;
      };
    }

    const relationCount = ext[PRISMA_NEXT_RELATION_COUNT] as { relationName: string } | undefined;
    if (relationCount) {
      return (parent, _args, _context, info) => {
        const value = readReshapedField(parent as Record<string, unknown>, info.fieldName);
        if (value === undefined) {
          throw new Error(
            `[pothos-prisma-next] relationCount '${info.parentType.name}.${info.fieldName}' was reached from a parent ` +
              'not loaded by t.prismaField.',
          );
        }
        return value;
      };
    }

    // ---- t.exposeX: passthrough that reads the column off parent
    const selectField = ext[PRISMA_NEXT_SELECT_FIELD] as string | undefined;
    if (selectField) {
      return (parent) => (parent as Record<string, unknown>)[selectField];
    }

    return resolver;
  }
}

/**
 * Read a field from a parent that may have been reshaped by combine. The
 * walker stores `combine` results under the parent's relation key as
 * `parent[relationName] = { branchA: ..., branchB: ... }`. The reshape
 * (run by `applySelectionToCollection`) lifts those branch values onto
 * `parent[branchAlias]` so resolvers see flat keys regardless of whether
 * combine was used. This helper just falls back to the legacy nested
 * shape if reshape didn't run for some reason (e.g. parent loaded
 * elsewhere).
 */
function readReshapedField(parent: Record<string, unknown>, alias: string): unknown {
  if (alias in parent) return parent[alias];
  return undefined;
}

SchemaBuilder.registerPlugin(pluginName, PothosPrismaNextPlugin);

export { PothosPrismaNextPlugin as default_ };
