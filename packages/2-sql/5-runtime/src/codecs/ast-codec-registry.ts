import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { ContractCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { CodecDescriptorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { createAstCodecResolver } from './ast-codec-resolver';

/**
 * Build a contract-free {@link ContractCodecRegistry} that resolves codecs
 * purely from AST-supplied {@link import('@prisma-next/framework-components/codec').CodecRef}s
 * against a target's descriptor registry.
 *
 * Dispatch is driven entirely by `CodecRef`s embedded in AST nodes; no
 * contract walk is needed. `forColumn` always returns `undefined` — this
 * registry carries no column-to-codec mappings.
 */
export function createAstCodecRegistry(
  descriptors: CodecDescriptorRegistry,
): ContractCodecRegistry {
  const resolver = createAstCodecResolver(descriptors, (ref) => ({
    name: ref.codecId,
    usedAt: [],
  }));
  return {
    forColumn: () => undefined,
    forCodecRef: (ref) => resolver.forCodecRef(ref),
  };
}

/**
 * Wrap a {@link CodecLookup} as a {@link ContractCodecRegistry}.
 *
 * `forColumn` returns `undefined` — this registry carries no column-to-codec
 * mappings. `forCodecRef` delegates to `lookup.getForRef`, which validates
 * `typeParams` and throws `RUNTIME.TYPE_PARAMS_INVALID` on failure.
 * Throws `RUNTIME.CODEC_DESCRIPTOR_MISSING` when `codecId` is not registered.
 */
export function contractCodecRegistryFromLookup(lookup: CodecLookup): ContractCodecRegistry {
  return {
    forColumn: () => undefined,
    forCodecRef(ref) {
      const codec = lookup.getForRef(ref.codecId, ref.typeParams);
      if (codec === undefined) {
        throw runtimeError(
          'RUNTIME.CODEC_DESCRIPTOR_MISSING',
          `No codec descriptor registered for codecId '${ref.codecId}'.`,
          { codecId: ref.codecId },
        );
      }
      return codec;
    },
  };
}
