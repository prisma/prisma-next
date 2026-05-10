/**
 * `createCipherstashRuntimeDescriptor({ sdk })` — the consumer-facing
 * wrapper that composes the SDK-bound parameterized codec descriptor
 * into a single `SqlRuntimeExtensionDescriptor<'postgres'>`.
 *
 * The wrapper exposes the parameterized descriptor on
 * `types.codecTypes.codecDescriptors` and through `codecs()`. The
 * runtime extracts the descriptor at dispatch time and resolves a
 * per-instance codec via `descriptor.factory(params)(ctx)`. The
 * bulk-encrypt middleware ships separately under `./middleware`.
 *
 * Mirrors the pgvector wrapper at
 * `packages/3-extensions/pgvector/src/exports/runtime.ts:62-88`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { CipherstashSdk } from '../src/execution/sdk';
import {
  CIPHERSTASH_EXTENSION_VERSION,
  createCipherstashRuntimeDescriptor,
} from '../src/exports/runtime';
import {
  CIPHERSTASH_SPACE_ID,
  CIPHERSTASH_STRING_CODEC_ID,
} from '../src/extension-metadata/constants';

function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

describe('createCipherstashRuntimeDescriptor — descriptor shape', () => {
  it('declares kind=extension with the cipherstash id, version, family, target', () => {
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    expect(descriptor.kind).toBe('extension');
    expect(descriptor.id).toBe(CIPHERSTASH_SPACE_ID);
    expect(descriptor.version).toBe(CIPHERSTASH_EXTENSION_VERSION);
    expect(descriptor.familyId).toBe('sql');
    expect(descriptor.targetId).toBe('postgres');
  });

  it('exposes one codec descriptor under types.codecTypes.codecDescriptors', () => {
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const codecDescriptors = descriptor.types?.codecTypes?.codecDescriptors ?? [];
    expect(codecDescriptors).toHaveLength(1);
    expect(codecDescriptors[0]?.codecId).toBe(CIPHERSTASH_STRING_CODEC_ID);
  });
});

describe('createCipherstashRuntimeDescriptor — codecs()', () => {
  it('returns the parameterized codec descriptor for cipherstash/string@1', () => {
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const codecs = descriptor.codecs?.() ?? [];
    expect(codecs).toHaveLength(1);
    const only = codecs[0]!;
    expect(only.codecId).toBe(CIPHERSTASH_STRING_CODEC_ID);
    expect(only.targetTypes).toEqual(['eql_v2_encrypted']);
    // Empty traits — equality search routes through the cipherstash-
    // namespaced `cipherstashEq` operator (see codec-runtime.test.ts
    // for the regression assertion + rationale).
    expect(only.traits).toEqual([]);
  });
});

describe('createCipherstashRuntimeDescriptor — create() returns a target-bound instance', () => {
  it('returns a SqlRuntimeExtensionInstance carrying the SQL family and Postgres target', () => {
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const instance = descriptor.create();
    expect(instance.familyId).toBe('sql');
    expect(instance.targetId).toBe('postgres');
  });
});

describe('createCipherstashRuntimeDescriptor — SDK isolation per descriptor', () => {
  it('produces a different codec instance per invocation so per-tenant SDKs do not cross-talk', () => {
    const a = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const b = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const codecA = a.codecs?.()[0]?.factory({ equality: false, freeTextSearch: false })({
      name: 'x.y',
    });
    const codecB = b.codecs?.()[0]?.factory({ equality: false, freeTextSearch: false })({
      name: 'x.y',
    });
    expect(codecA).not.toBe(codecB);
  });
});
