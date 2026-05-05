import { RootFieldBuilder } from '@pothos/core';
import { PRISMA_NEXT_PREPARED } from './types';

interface PrismaFieldInternalOptions {
  type: string;
  resolve: unknown;
  description?: string;
  args?: unknown;
  nullable?: boolean;
}

const rootFieldBuilderProto = RootFieldBuilder.prototype as unknown as Record<string, unknown>;

/**
 * `t.prismaField({ type: 'User', resolve: (collection, ...) => ... })`
 *
 * Registers an entry-point field that targets a prisma-next model. The
 * plugin's `wrapResolve` reads `extensions[PRISMA_NEXT_PREPARED]` to
 * detect this and prepares a Collection from `info` before calling the
 * user resolver.
 *
 * Lives on `RootFieldBuilder` so it's available on Query, Mutation, and
 * regular object fields. For per-prismaObject fields with `t.relation`
 * and `t.relationCount`, see `PrismaNextObjectFieldBuilder` in
 * `./prisma-object-field-builder.ts`.
 */
rootFieldBuilderProto['prismaField'] = function prismaField(
  this: { field: (cfg: unknown) => unknown },
  options: PrismaFieldInternalOptions,
) {
  const { type, resolve, ...rest } = options;
  return this.field({
    ...rest,
    type,
    resolve: resolve as never,
    extensions: {
      [PRISMA_NEXT_PREPARED]: type,
    },
  });
};
