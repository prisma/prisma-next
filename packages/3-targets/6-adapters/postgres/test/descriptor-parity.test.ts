import { describe, expect, it } from 'vitest';
import postgresRuntimeAdapterDescriptor from '../src/exports/runtime';

describe('adapter descriptor / instance codec parity', () => {
  it('descriptor codecs() matches adapter instance profile.codecs() codec IDs', () => {
    const descriptorCodecIds = new Set(
      [...postgresRuntimeAdapterDescriptor.codecs().values()].map((c) => c.id),
    );

    const adapterInstance = postgresRuntimeAdapterDescriptor.create();
    const instanceCodecIds = new Set(
      [...adapterInstance.profile.codecs().values()].map((c) => c.id),
    );

    expect(descriptorCodecIds.size).toBeGreaterThan(0);
    expect(descriptorCodecIds).toEqual(instanceCodecIds);
  });
});
