import { describe, expect, it } from 'vitest';
import { mongoTargetDescriptorMeta } from '../src/core/descriptor-meta';

describe('mongoTargetDescriptorMeta', () => {
  it('has the expected shape', () => {
    expect(mongoTargetDescriptorMeta).toEqual({
      kind: 'target',
      familyId: 'mongo',
      targetId: 'mongo',
      id: 'mongo',
      version: '0.0.1',
      capabilities: {},
    });
  });
});
