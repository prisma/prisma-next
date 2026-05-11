import type { CodecRef } from '@prisma-next/framework-components/codec';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import { canonicalizeJson } from '@prisma-next/framework-components/utils';
import type { Codec, SqlCodecInstanceContext } from '@prisma-next/sql-relational-core/ast';
import type { CodecDescriptorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';

/**
 * Per-`ExecutionContext` resolver that materialises the {@link Codec} for a {@link CodecRef} carried on an AST node.
 *
 * Wraps `descriptorFor(codecId).factory(typeParams)(ctx)` with a content-keyed cache: lookups are keyed by `${codecId}:${canonicalizeJson(typeParams)}`, so two refs with the same `codecId` and structurally equal `typeParams` (regardless of object key order) resolve to the same memoised codec instance. Non-parameterized codecs key as `${codecId}:undefined` and share one instance per resolver.
 *
 * AST-bound codec resolution dissolves the legacy column-aware dispatch path: every codec-bearing AST node carries the canonical `CodecRef` directly, so the resolver is the single dispatch shape encode and decode share. Refs the contract walk pre-populates hit on first call; refs the AST supplies (e.g. deserialised migration ops) populate the cache lazily.
 */
export interface AstCodecResolver {
  /**
   * Resolve the {@link Codec} for the supplied {@link CodecRef}.
   *
   * Throws `RUNTIME.CODEC_DESCRIPTOR_MISSING` when no descriptor is registered for `ref.codecId`. Throws `RUNTIME.TYPE_PARAMS_INVALID` when the descriptor's `paramsSchema` rejects `ref.typeParams` (validated only on cache miss; subsequent lookups for the same canonical key skip validation).
   */
  forCodecRef(ref: CodecRef): Codec;
}

/**
 * Build an {@link AstCodecResolver} bound to a descriptor registry and a per-call instance-context factory.
 *
 * The instance-context factory lets callers control `name` / `usedAt` for refs the AST supplies (e.g. AST-embedded migration ops where the materialisation site is the AST node, not a contract column). The contract-walk pre-population path constructs its own contexts and invokes the resolver with those refs to seed the cache.
 */
export function createAstCodecResolver(
  descriptors: CodecDescriptorRegistry,
  instanceContextFor: (ref: CodecRef) => SqlCodecInstanceContext,
): AstCodecResolver {
  const cache = new Map<string, Codec>();

  return {
    forCodecRef(ref: CodecRef): Codec {
      const key = `${ref.codecId}:${canonicalizeJson(ref.typeParams)}`;
      const cached = cache.get(key);
      if (cached) return cached;

      const descriptor = descriptors.descriptorFor(ref.codecId);
      if (!descriptor) {
        throw runtimeError(
          'RUNTIME.CODEC_DESCRIPTOR_MISSING',
          `No codec descriptor registered for codecId '${ref.codecId}'.`,
          { codecId: ref.codecId },
        );
      }

      const effectiveRef =
        descriptor.isParameterized && ref.typeParams === undefined
          ? { codecId: ref.codecId, typeParams: {} }
          : ref;
      const validated = validateTypeParams(descriptor.paramsSchema, effectiveRef);
      const ctx = instanceContextFor(ref);
      // The descriptor's `factory` is typed against its own `P`; the registry erases `P` to `unknown`, so callers narrow per codec id at the dispatch boundary. The descriptor's `paramsSchema` validates the input above before we forward it, so this narrow is safe by construction.
      const codec = (
        descriptor.factory as (params: unknown) => (ctx: SqlCodecInstanceContext) => Codec
      )(validated)(ctx);

      cache.set(key, codec);
      return codec;
    },
  };
}

function validateTypeParams(
  paramsSchema: { '~standard': { validate: (input: unknown) => unknown } },
  ref: CodecRef,
): unknown {
  const result = paramsSchema['~standard'].validate(ref.typeParams) as
    | { value: unknown }
    | { issues: ReadonlyArray<{ message: string }> }
    | Promise<unknown>;

  if (result instanceof Promise) {
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `paramsSchema for codec '${ref.codecId}' returned a Promise; runtime validation requires a synchronous Standard Schema validator.`,
      { codecId: ref.codecId, typeParams: ref.typeParams },
    );
  }

  if ('issues' in result && result.issues) {
    const messages = result.issues.map((issue) => issue.message).join('; ');
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `Invalid typeParams for codec '${ref.codecId}': ${messages}`,
      { codecId: ref.codecId, typeParams: ref.typeParams },
    );
  }

  return (result as { value: unknown }).value;
}
