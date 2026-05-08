/**
 * `createCipherstashRuntimeDescriptor({ sdk })` — F5 / AC-CODEC5
 * (PASS-without-caveat) and the consumer-facing wrapper that
 * unblocks AC-UMB9's byte-level bundling assertion.
 *
 * The wrapper composes the SDK-bound codec runtime + the
 * parameterized-codec descriptor list + the codec-instances metadata
 * slot into a single `SqlRuntimeExtensionDescriptor<'postgres'>` so
 * consumers wire the runtime once instead of stitching the pieces by
 * hand. The bulk-encrypt middleware ships separately under the
 * `./middleware` entry and is composed via `createRuntime({ middleware
 * })` because `SqlRuntimeExtensionDescriptor` does not own a
 * middleware slot.
 *
 * Mirrors the pgvector wrapper at
 * `packages/3-extensions/pgvector/src/exports/runtime.ts:62-88`.
 */

import { describe, expect, it, vi } from 'vitest';
import { CIPHERSTASH_SPACE_ID, CIPHERSTASH_STRING_CODEC_ID } from '../src/core/constants';
import type { CipherstashSdk } from '../src/core/sdk';
import {
  CIPHERSTASH_EXTENSION_VERSION,
  createCipherstashRuntimeDescriptor,
} from '../src/exports/runtime';

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

  it('exposes codec instances under types.codecTypes.codecInstances for runtime-plane lookup', () => {
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const codecInstances = descriptor.types?.codecTypes?.codecInstances ?? [];
    expect(codecInstances.length).toBe(1);
    expect(codecInstances[0]?.id).toBe(CIPHERSTASH_STRING_CODEC_ID);
  });
});

describe('createCipherstashRuntimeDescriptor — codecs() registry', () => {
  it('registers the cipherstash/string@1 codec into a fresh registry', () => {
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const registry = descriptor.codecs();
    expect(registry.has(CIPHERSTASH_STRING_CODEC_ID)).toBe(true);
    expect(registry.get(CIPHERSTASH_STRING_CODEC_ID)?.id).toBe(CIPHERSTASH_STRING_CODEC_ID);
  });

  it('routes lookup-by-scalar (eql_v2_encrypted) to the cipherstash codec', () => {
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const registry = descriptor.codecs();
    expect(registry.getDefaultCodec('eql_v2_encrypted')?.id).toBe(CIPHERSTASH_STRING_CODEC_ID);
  });
});

describe('createCipherstashRuntimeDescriptor — parameterizedCodecs() descriptors', () => {
  it('returns a single descriptor for cipherstash/string@1 with the equality trait and eql_v2_encrypted target', () => {
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const descriptors = descriptor.parameterizedCodecs();
    expect(descriptors).toHaveLength(1);
    const only = descriptors[0]!;
    expect(only.codecId).toBe(CIPHERSTASH_STRING_CODEC_ID);
    expect(only.traits).toEqual(['equality']);
    expect(only.targetTypes).toEqual(['eql_v2_encrypted']);
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
  it('yields a different codec object for each invocation so per-tenant SDKs do not cross-talk', () => {
    const a = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const b = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const codecA = a.codecs().get(CIPHERSTASH_STRING_CODEC_ID);
    const codecB = b.codecs().get(CIPHERSTASH_STRING_CODEC_ID);
    expect(codecA).not.toBe(codecB);
  });
});
