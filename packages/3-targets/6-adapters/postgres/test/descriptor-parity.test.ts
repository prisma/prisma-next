import type { ExecutionStack } from '@prisma-next/framework-components/execution';
import { describe, expect, it } from 'vitest';
import postgresRuntimeAdapterDescriptor from '../src/exports/runtime';

describe('adapter descriptor / instance codec parity', () => {
  it('descriptor codecs() matches adapter instance profile.codecs() codec IDs', () => {
    const descriptorCodecIds = new Set(
      [...postgresRuntimeAdapterDescriptor.codecs().values()].map((c) => c.id),
    );

    // The adapter reads stack metadata to derive a `codecLookup` for the
    // renderer; minimal stub that satisfies that path. Codec contents come
    // from the adapter descriptor itself, so the inner `target` need only
    // expose its `id` for `extractCodecLookup`'s ownership tracking.
    const stack = {
      target: { id: 'postgres' },
      adapter: postgresRuntimeAdapterDescriptor,
      extensionPacks: [],
    } as unknown as ExecutionStack<'sql', 'postgres'>;
    const adapterInstance = postgresRuntimeAdapterDescriptor.create(stack);
    const instanceCodecIds = new Set(
      [...adapterInstance.profile.codecs().values()].map((c) => c.id),
    );

    expect(descriptorCodecIds.size).toBeGreaterThan(0);
    expect(descriptorCodecIds).toEqual(instanceCodecIds);
  });
});
