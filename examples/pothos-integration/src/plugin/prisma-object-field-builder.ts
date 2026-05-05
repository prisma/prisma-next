import { ObjectFieldBuilder, type SchemaTypes } from '@pothos/core';
import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { getOrCreateModelRef } from './ref-cache';
import { PRISMA_NEXT_RELATION, PRISMA_NEXT_RELATION_COUNT } from './types';

interface RelationMeta {
  to: string;
  cardinality: '1:1' | '1:N' | 'N:1' | 'M:N' | string;
}

interface RelationOpts {
  description?: string;
  nullable?: boolean;
  args?: unknown;
  query?: unknown;
}

interface RelationCountOpts {
  description?: string;
  args?: unknown;
  where?: unknown;
}

/**
 * Custom field builder used inside `prismaObject`. Carries the model name
 * + contract metadata so that `t.relation('posts')` can resolve the
 * relation's target type at registration time.
 *
 * Inherits `t.field`, `t.string`, `t.int`, `t.exposeID`, `t.exposeString`,
 * etc. from `ObjectFieldBuilder` for free.
 */
export class PrismaNextObjectFieldBuilder<
  Types extends SchemaTypes,
  ParentShape extends object,
> extends ObjectFieldBuilder<Types, ParentShape> {
  readonly modelName: string;
  readonly contract: Contract<SqlStorage>;

  constructor(
    builder: PothosSchemaTypes.SchemaBuilder<Types>,
    modelName: string,
    contract: Contract<SqlStorage>,
  ) {
    super(builder);
    this.modelName = modelName;
    this.contract = contract;
  }

  override relation(name: string, options?: RelationOpts) {
    const opts = options ?? {};
    const meta = this.#getRelationMeta(name);
    const targetRef = getOrCreateModelRef(
      this.builder as unknown as PothosSchemaTypes.SchemaBuilder<SchemaTypes>,
      meta.to,
    );
    const isToMany = meta.cardinality === '1:N' || meta.cardinality === 'M:N';

    return (this as unknown as { field: (cfg: unknown) => unknown }).field({
      type: isToMany ? [targetRef] : targetRef,
      description: opts.description,
      nullable: opts.nullable ?? !isToMany,
      args: opts.args,
      extensions: {
        [PRISMA_NEXT_RELATION]: {
          relationName: name,
          parentModel: this.modelName,
          targetModel: meta.to,
          cardinality: meta.cardinality,
          opts,
        },
      },
      resolve: () => {
        throw new Error(
          '[pothos-prisma-next] t.relation resolver was not wrapped by the plugin (this is a bug).',
        );
      },
    }) as never;
  }

  override relationCount(name: string, options?: RelationCountOpts) {
    const opts = options ?? {};
    this.#getRelationMeta(name); // Throws if relation doesn't exist on this model.

    return (this as unknown as { field: (cfg: unknown) => unknown }).field({
      type: 'Int',
      description: opts.description,
      nullable: false,
      args: opts.args,
      extensions: {
        [PRISMA_NEXT_RELATION_COUNT]: {
          relationName: name,
          parentModel: this.modelName,
          opts,
        },
      },
      resolve: () => {
        throw new Error(
          '[pothos-prisma-next] t.relationCount resolver was not wrapped by the plugin (this is a bug).',
        );
      },
    }) as never;
  }

  #getRelationMeta(relationName: string): RelationMeta {
    const models = (this.contract as { models: Record<string, unknown> }).models;
    const model = models[this.modelName] as
      | { relations?: Record<string, RelationMeta> }
      | undefined;
    if (!model) {
      throw new Error(
        `[pothos-prisma-next] Model '${this.modelName}' not found in contract.models.`,
      );
    }
    const rel = model.relations?.[relationName];
    if (!rel) {
      throw new Error(
        `[pothos-prisma-next] Relation '${relationName}' not found on model '${this.modelName}'. ` +
          `Available: ${Object.keys(model.relations ?? {}).join(', ') || '(none)'}`,
      );
    }
    return rel;
  }
}
