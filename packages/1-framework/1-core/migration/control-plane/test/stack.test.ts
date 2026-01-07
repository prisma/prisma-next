import { describe, expect, it } from 'vitest';
import { createControlPlaneStack } from '../src/stack';
import type { ControlAdapterDescriptor, ControlTargetDescriptor } from '../src/types';

describe('createControlPlaneStack', () => {
  it('defaults driver to undefined and extensionPacks to []', () => {
    const target = {
      kind: 'target',
      familyId: 'sql',
      targetId: 'postgres',
    } as unknown as ControlTargetDescriptor<'sql', 'postgres'>;

    const adapter = {
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
    } as unknown as ControlAdapterDescriptor<'sql', 'postgres'>;

    const stack = createControlPlaneStack({ target, adapter });

    expect(stack).toMatchObject({
      target,
      adapter,
      driver: undefined,
      extensionPacks: [],
    });
  });
});
