import SchemaBuilder, { type SchemaTypes } from '@pothos/core';
import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { PrismaNextObjectFieldBuilder } from './prisma-object-field-builder';
import { getOrCreateModelRef } from './ref-cache';
import { PRISMA_NEXT_MODEL } from './types';

const schemaBuilderProto =
  SchemaBuilder.prototype as unknown as PothosSchemaTypes.SchemaBuilder<SchemaTypes>;

interface PrismaObjectInternalOptions {
  description?: string;
  fields?: (t: unknown) => Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

/**
 * `builder.prismaObject(modelName, options)` registers a GraphQL object
 * type bound to a prisma-next contract model. The model name is stored
 * on the type config under `extensions.pothosPrismaNextModel` so the
 * auto-include walker and resolve wrapper can identify the type as
 * prisma-next-backed at runtime.
 *
 * The user's `fields(t)` callback receives a `PrismaNextObjectFieldBuilder`
 * pre-bound to the model + contract, so `t.relation('posts')` can resolve
 * the target type from the contract at registration time.
 */
schemaBuilderProto.prismaObject = function prismaObject(
  this: PothosSchemaTypes.SchemaBuilder<SchemaTypes>,
  modelName: string,
  options: PrismaObjectInternalOptions,
) {
  const opts = options;
  const builderOpts = (
    this as unknown as { options: { prismaNext: { contract: Contract<SqlStorage> } } }
  ).options;
  const contract = builderOpts.prismaNext.contract;

  const ref = getOrCreateModelRef(this, modelName);

  (
    this as unknown as {
      objectType: (ref: unknown, options: unknown) => unknown;
    }
  ).objectType(ref, {
    description: opts.description,
    extensions: {
      ...(opts.extensions ?? {}),
      [PRISMA_NEXT_MODEL]: modelName,
    },
    fields: opts.fields
      ? () => opts.fields?.(new PrismaNextObjectFieldBuilder(this, modelName, contract))
      : undefined,
    name: modelName,
  });

  return ref as never;
} as never;
