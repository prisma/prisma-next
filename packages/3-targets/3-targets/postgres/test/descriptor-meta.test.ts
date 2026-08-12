import { describe, expect, it } from 'vitest';
import { postgresTargetDescriptorMeta } from '../src/core/descriptor-meta';
import postgresTargetPack from '../src/exports/pack';

describe('postgresTargetDescriptorMeta', () => {
  it('declares the expected defaultNamespaceId', () => {
    expect(postgresTargetDescriptorMeta.defaultNamespaceId).toBe('public');
  });
});

describe('postgresTargetPack', () => {
  it('matches the descriptor metadata', () => {
    expect(postgresTargetPack).toEqual(postgresTargetDescriptorMeta);
  });
});
