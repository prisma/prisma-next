import { describe, expect, it } from 'vitest';
import { createControlPlaneStack } from '../src/stack';

describe('createControlPlaneStack', () => {
  it('defaults driver to undefined and extensionPacks to []', () => {
    const target = { kind: 'target', familyId: 'sql', targetId: 'postgres' } as const;
    const adapter = { kind: 'adapter', familyId: 'sql', targetId: 'postgres' } as const;

    const stack = createControlPlaneStack({
      target: target as unknown,
      adapter: adapter as unknown,
    });

    expect(stack).toMatchObject({
      target,
      adapter,
      driver: undefined,
      extensionPacks: [],
    });
  });
});
