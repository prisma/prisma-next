import { describe, expect, it } from 'vitest';
import { mongoTargetDescriptorMeta } from '../src/core/descriptor-meta';
import mongoTargetPack from '../src/exports/pack';

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

describe('mongoTargetPack', () => {
  it('matches the descriptor metadata', () => {
    expect(mongoTargetPack).toEqual(mongoTargetDescriptorMeta);
  });
});
