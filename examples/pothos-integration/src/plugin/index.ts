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
import { PRISMA_NEXT_PREPARED, PRISMA_NEXT_RELATION, PRISMA_NEXT_RELATION_COUNT } from './types';

const pluginName = 'prismaNext';

export default pluginName;

export class PothosPrismaNextPlugin<Types extends SchemaTypes> extends BasePlugin<Types> {
  override wrapResolve(
    resolver: GraphQLFieldResolver<unknown, Types['Context'], object>,
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): GraphQLFieldResolver<unknown, Types['Context'], object> {
    const ext = (fieldConfig.extensions ?? {}) as Record<string | symbol, unknown>;

    // ---- t.prismaField: prepare a Collection from info, hand it to the user resolver,
    //      then reshape the result so combine branches lift to flat parent keys.
    if (ext[PRISMA_NEXT_PREPARED]) {
      const modelName = ext[PRISMA_NEXT_PREPARED] as string;
      return async (parent, args, context, info) => {
        const opts = this.builder.options.prismaNext;
        const baseCollection = (opts.db as unknown as Record<string, unknown>)[modelName];
        if (!baseCollection) {
          throw new Error(
            `[pothos-prisma-next] No collection registered for model '${modelName}' on builder.options.prismaNext.db. ` +
              'Make sure the contract has this model and the orm() client was constructed with it.',
          );
        }
        const { collection, reshape } = applySelectionToCollection(
          baseCollection as never,
          info,
          this.buildCache as never,
          context,
        );
        const result = await (
          resolver as unknown as (
            collection: unknown,
            parent: unknown,
            args: unknown,
            context: unknown,
            info: GraphQLResolveInfo,
          ) => unknown
        )(collection, parent, args, context, info);
        if (result == null) return result;
        return Array.isArray(result) ? result.map((row) => reshape(row)) : reshape(result);
      };
    }

    // ---- t.relation: read the value from the (possibly reshaped) parent.
    //
    // After the walker's reshape runs, the parent has flat keys: `parent.drafts`,
    // `parent.posts`, etc. — even when combine was used under the hood. We
    // first check `parent[fieldName]` (post-reshape), then fall back to the
    // raw `parent[relationName]` (pre-reshape, which is the plain-include
    // case where field name === relation name and reshape was a no-op).
    const relation = ext[PRISMA_NEXT_RELATION] as { relationName: string } | undefined;
    if (relation) {
      return (parent, _args, _context, info) => {
        const p = parent as Record<string, unknown>;
        const value = info.fieldName in p ? p[info.fieldName] : p[relation.relationName];
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

    // ---- t.relationCount: read the value from the (reshape-lifted) parent key.
    const relationCount = ext[PRISMA_NEXT_RELATION_COUNT] as { relationName: string } | undefined;
    if (relationCount) {
      return (parent, _args, _context, info) => {
        const p = parent as Record<string, unknown>;
        const value = p[info.fieldName];
        if (value === undefined) {
          throw new Error(
            `[pothos-prisma-next] relationCount '${info.parentType.name}.${info.fieldName}' was reached from a parent ` +
              'not loaded by t.prismaField.',
          );
        }
        return value;
      };
    }

    return resolver;
  }
}

SchemaBuilder.registerPlugin(pluginName, PothosPrismaNextPlugin);

export { PothosPrismaNextPlugin as default_ };
