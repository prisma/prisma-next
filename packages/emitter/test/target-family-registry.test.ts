import { describe, it, expect } from 'vitest';
import { targetFamilyRegistry } from '../src/target-family-registry';
import type { TargetFamilyHook } from '../src/target-family';

describe('target-family-registry', () => {
  it('registers and retrieves hooks', () => {
    const mockHook: TargetFamilyHook = {
      id: 'test',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
      getTypesImports: () => [],
    };

    targetFamilyRegistry.register(mockHook);
    expect(targetFamilyRegistry.get('test')).toBe(mockHook);
    expect(targetFamilyRegistry.has('test')).toBe(true);
  });

  it('throws error for duplicate registration', () => {
    const mockHook: TargetFamilyHook = {
      id: 'duplicate',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
      getTypesImports: () => [],
    };

    targetFamilyRegistry.register(mockHook);
    expect(() => {
      targetFamilyRegistry.register(mockHook);
    }).toThrow();
  });

  it('throws error for missing hook', () => {
    expect(() => {
      targetFamilyRegistry.require('nonexistent');
    }).toThrow();
  });
});

