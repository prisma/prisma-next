/**
 * Runtime-plane entry point for the CipherStash extension.
 *
 * Consumed at query time by application runtimes that need to encode /
 * decode `cipherstash/string@1` columns (envelope class) and talk to the
 * CipherStash SDK shape the codec runtime + bulk-encrypt middleware
 * depend on.
 *
 * The runtime entry point is deliberately separate from `./control`
 * (descriptor, codec lifecycle hook, contract-space artefacts) so apps
 * that only emit migrations against cipherstash never load the runtime,
 * and apps that only run queries never load the migration-time
 * descriptor (project AC-UMB9 — tree-shakable control vs runtime
 * planes).
 *
 * `createCipherstashRuntimeDescriptor({ sdk })` is the recommended
 * composition entry — it bundles the SDK-bound codec, the parameterized
 * codec descriptor, and the runtime-plane `codecInstances` slot into a
 * single `SqlRuntimeExtensionDescriptor<'postgres'>` mirroring
 * pgvector's `runtime.ts` precedent. The bulk-encrypt middleware ships
 * separately at `@prisma-next/extension-cipherstash/middleware` because
 * `SqlRuntimeExtensionDescriptor` does not own a middleware slot;
 * consumers register it via `createRuntime({ middleware:
 * [bulkEncryptMiddleware(sdk)] })`.
 */

import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { createCipherstashStringCodec } from '../execution/codec-runtime';
import { cipherstashQueryOperations } from '../execution/operators';
import { createParameterizedCodecDescriptors } from '../execution/parameterized';
import type { CipherstashSdk } from '../execution/sdk';
import { CIPHERSTASH_SPACE_ID } from '../extension-metadata/constants';

export type { CipherstashStringCodec } from '../execution/codec-runtime';
export {
  CIPHERSTASH_STRING_CODEC_ID,
  createCipherstashStringCodec,
} from '../execution/codec-runtime';
export type { DecryptAllOptions } from '../execution/decrypt-all';
export { decryptAll } from '../execution/decrypt-all';
export type { EncryptedStringFromInternalArgs } from '../execution/envelope';
export { EncryptedString } from '../execution/envelope';
export type { CipherstashStringParams } from '../execution/parameterized';
export {
  createParameterizedCodecDescriptors,
  encryptedStringParamsSchema,
  renderEncryptedStringOutputType,
} from '../execution/parameterized';
export type {
  CipherstashBulkDecryptArgs,
  CipherstashBulkEncryptArgs,
  CipherstashRoutingKey,
  CipherstashSdk,
  CipherstashSingleDecryptArgs,
} from '../execution/sdk';

export const CIPHERSTASH_EXTENSION_VERSION = '0.0.1' as const;

export interface CreateCipherstashRuntimeDescriptorOptions {
  readonly sdk: CipherstashSdk;
}

/**
 * Compose the SDK-bound codec runtime + parameterized codec descriptors
 * + runtime-plane codec-instances metadata into a single
 * `SqlRuntimeExtensionDescriptor<'postgres'>`.
 *
 * The descriptor is per-SDK: cipherstash's codec captures the SDK at
 * `decode` time (read-side single-cell `decrypt`) and the bulk-encrypt
 * middleware captures it at `beforeExecute` time (write-side bulk
 * round-trip). Multi-tenant deployments construct one descriptor per
 * tenant SDK so per-tenant key material never crosses runtimes.
 *
 * Mirrors `packages/3-extensions/pgvector/src/exports/runtime.ts` —
 * pgvector's vectorRuntimeDescriptor is a static default-export because
 * its codec is fully stateless; cipherstash needs the factory wrapper
 * because the codec depends on `sdk`.
 */
export function createCipherstashRuntimeDescriptor(
  opts: CreateCipherstashRuntimeDescriptorOptions,
): SqlRuntimeExtensionDescriptor<'postgres'> {
  const { sdk } = opts;
  const codec = createCipherstashStringCodec(sdk);
  const parameterizedDescriptors = createParameterizedCodecDescriptors(sdk);

  return {
    kind: 'extension' as const,
    id: CIPHERSTASH_SPACE_ID,
    version: CIPHERSTASH_EXTENSION_VERSION,
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    types: {
      codecTypes: {
        codecInstances: [codec],
      },
    },
    codecs: () => {
      const registry = createCodecRegistry();
      registry.register(codec);
      return registry;
    },
    parameterizedCodecs: () => parameterizedDescriptors,
    queryOperations: () => cipherstashQueryOperations(),
    create() {
      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
      };
    },
  };
}
