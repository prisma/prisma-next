import { describe, expect, it } from 'vitest';
import { checkContractComponentRequirements } from '../src/framework-components.ts';

describe('checkContractComponentRequirements', () => {
  it('returns empty result when requirements are satisfied', () => {
    const result = checkContractComponentRequirements({
      contract: {
        targetFamily: 'sql',
        target: 'postgres',
        extensionPacks: { pgvector: {} },
      },
      expectedTargetFamily: 'sql',
      expectedTargetId: 'postgres',
      providedComponentIds: ['postgres', 'postgres-adapter', 'pgvector'],
    });

    expect(result).toEqual({
      missingExtensionPackIds: [],
    });
  });

  it('returns familyMismatch when expectedTargetFamily mismatches', () => {
    const result = checkContractComponentRequirements({
      contract: {
        targetFamily: 'document',
        target: 'postgres',
        extensionPacks: {},
      },
      expectedTargetFamily: 'sql',
      expectedTargetId: 'postgres',
      providedComponentIds: ['postgres', 'postgres-adapter'],
    });

    expect(result).toEqual({
      familyMismatch: { expected: 'sql', actual: 'document' },
      missingExtensionPackIds: [],
    });
  });

  it('returns targetMismatch when expectedTargetId mismatches', () => {
    const result = checkContractComponentRequirements({
      contract: {
        targetFamily: 'sql',
        target: 'mysql',
        extensionPacks: {},
      },
      expectedTargetFamily: 'sql',
      expectedTargetId: 'postgres',
      providedComponentIds: ['postgres', 'postgres-adapter'],
    });

    expect(result).toEqual({
      targetMismatch: { expected: 'postgres', actual: 'mysql' },
      missingExtensionPackIds: [],
    });
  });

  it('returns missingExtensionPackIds when required packs are not provided', () => {
    const result = checkContractComponentRequirements({
      contract: {
        target: 'postgres',
        extensionPacks: { pgvector: {} },
      },
      expectedTargetId: 'postgres',
      providedComponentIds: ['postgres', 'postgres-adapter'],
    });

    expect(result).toEqual({
      missingExtensionPackIds: ['pgvector'],
    });
  });
});
