/**
 * SQL runtime extension descriptor for cipherstash.
 *
 * Mirrors `packages/3-extensions/pgvector/src/exports/runtime.ts`
 * structurally, with one difference: cipherstash's codec depends on a
 * caller-supplied `CipherstashSdk`, so the descriptor is a *factory*
 * (`createCipherstashRuntimeDescriptor({ sdk })`) rather than a static
 * default-export. M2.b/M2.c will likely add a thinner top-level
 * factory (`cipherstashRuntime({ sdk, ... })`) that returns this
 * descriptor; this file ships the descriptor builder in M2.a so the
 * codec + parameterized-codec wiring can be unit-tested in isolation.
 */

import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { createCipherstashStringCodec } from '../core/codecs';
import { createParameterizedCodecDescriptors } from '../core/parameterized';
import type { CipherstashSdk } from '../core/sdk';

export const CIPHERSTASH_EXTENSION_ID = 'cipherstash' as const;
export const CIPHERSTASH_EXTENSION_VERSION = '0.0.1' as const;

export interface CreateCipherstashRuntimeDescriptorOptions {
  readonly sdk: CipherstashSdk;
}

export function createCipherstashRuntimeDescriptor(
  opts: CreateCipherstashRuntimeDescriptorOptions,
): SqlRuntimeExtensionDescriptor<'postgres'> {
  const { sdk } = opts;
  const codec = createCipherstashStringCodec(sdk);
  const descriptors = createParameterizedCodecDescriptors(sdk);

  function buildCodecRegistry() {
    const registry = createCodecRegistry();
    registry.register(codec);
    return registry;
  }

  return {
    kind: 'extension' as const,
    id: CIPHERSTASH_EXTENSION_ID,
    version: CIPHERSTASH_EXTENSION_VERSION,
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    types: {
      codecTypes: {
        codecInstances: [codec],
      },
    },
    codecs: buildCodecRegistry,
    parameterizedCodecs: () => descriptors,
    create() {
      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
      };
    },
  };
}
