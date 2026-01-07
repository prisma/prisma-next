import type { ContractIR } from '@prisma-next/contract/ir';
import { CliStructuredError } from '@prisma-next/core-control-plane/errors';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import {
  assertContractRequirementsSatisfied,
  assertFrameworkComponentsCompatible,
} from '../../src/utils/framework-components.ts';

describe('assertFrameworkComponentsCompatible', () => {
  type TestComponent = {
    readonly kind: 'target' | 'adapter' | 'extension' | 'driver';
    readonly id: string;
    readonly version: string;
    readonly familyId?: string;
    readonly targetId?: string;
    readonly create?: () => unknown;
  };

  const createComponent = (
    kind: TestComponent['kind'],
    overrides: Partial<TestComponent> = {},
  ): TestComponent => ({
    kind,
    id: `${kind}-id`,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({}),
    ...overrides,
  });

  it('validates and returns components when all are compatible', () => {
    const components = [
      createComponent('target'),
      createComponent('adapter'),
      createComponent('extension'),
      createComponent('driver'),
    ];

    const result = assertFrameworkComponentsCompatible('sql', 'postgres', components);

    expect(result).toEqual(components);
  });

  it('throws CliStructuredError when component is not an object', () => {
    const components = ['not an object'];

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', components);
    }).toThrow(CliStructuredError);
  });

  it('throws CliStructuredError when component is null', () => {
    const components = [null];

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', components);
    }).toThrow(CliStructuredError);
  });

  it('throws CliStructuredError when component is missing kind property', () => {
    const components = [{ familyId: 'sql', targetId: 'postgres' }];

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', components);
    }).toThrow(CliStructuredError);
  });

  it('throws CliStructuredError when component has invalid kind', () => {
    const components = [{ kind: 'invalid', familyId: 'sql', targetId: 'postgres' }];

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', components);
    }).toThrow(CliStructuredError);
  });

  it('throws CliStructuredError when component is missing familyId property', () => {
    const components = [{ kind: 'target', targetId: 'postgres' }];

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', components);
    }).toThrow(CliStructuredError);
  });

  it('throws CliStructuredError when component has mismatched familyId', () => {
    const components = [createComponent('target', { familyId: 'document' })];

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', components);
    }).toThrow(CliStructuredError);
  });

  it('throws CliStructuredError when component is missing targetId property', () => {
    const components = [{ kind: 'adapter', familyId: 'sql' }];

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', components);
    }).toThrow(CliStructuredError);
  });

  it('throws CliStructuredError when component has mismatched targetId', () => {
    const components = [createComponent('adapter', { targetId: 'mysql' })];

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', components);
    }).toThrow(CliStructuredError);
  });

  it('validates all components in array', () => {
    const components = [
      createComponent('target'),
      createComponent('adapter', { familyId: 'document' }), // Wrong familyId
    ];

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', components);
    }).toThrow(CliStructuredError);
  });

  it('handles empty array', () => {
    const result = assertFrameworkComponentsCompatible('sql', 'postgres', []);
    expect(result).toEqual([]);
  });

  it('validates all component kinds', () => {
    const target = createComponent('target');
    const adapter = createComponent('adapter');
    const extension = createComponent('extension');
    const driver = createComponent('driver');

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', [target, adapter, extension, driver]);
    }).not.toThrow();
  });
});

describe('assertContractRequirementsSatisfied', () => {
  const contract: Pick<ContractIR, 'targetFamily' | 'target' | 'extensionPacks'> = {
    targetFamily: 'sql',
    target: 'postgres',
    extensionPacks: {
      pgvector: {},
    },
  };

  const target = {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
  } as unknown as ControlTargetDescriptor<'sql', 'postgres'>;

  const adapter = {
    kind: 'adapter',
    id: 'postgres-adapter',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
  } as unknown as ControlAdapterDescriptor<'sql', 'postgres'>;

  const extension = {
    kind: 'extension',
    id: 'pgvector',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
  } as unknown as ControlExtensionDescriptor<'sql', 'postgres'>;

  const createStack = (
    extensionPacks: readonly ControlExtensionDescriptor<'sql', 'postgres'>[] = [],
  ) => createControlPlaneStack({ target, adapter, extensionPacks });

  it('passes when target and extension packs are satisfied', () => {
    expect(() =>
      assertContractRequirementsSatisfied({
        contract,
        stack: createStack([extension]),
      }),
    ).not.toThrow();
  });

  it('throws when contract target family mismatches config', () => {
    expect(() =>
      assertContractRequirementsSatisfied({
        contract: { ...contract, targetFamily: 'document' },
        stack: createStack([extension]),
      }),
    ).toThrow(CliStructuredError);
  });

  it('throws when contract target mismatches config', () => {
    expect(() =>
      assertContractRequirementsSatisfied({
        contract: { ...contract, target: 'mysql' },
        stack: createStack([extension]),
      }),
    ).toThrow(CliStructuredError);
  });

  it('throws when required extension pack is missing', () => {
    try {
      assertContractRequirementsSatisfied({
        contract,
        stack: createStack([]),
      });
      throw new Error('expected assertContractRequirementsSatisfied to throw');
    } catch (error) {
      if (!(error instanceof CliStructuredError)) {
        throw error;
      }

      expect(error.meta).toMatchObject({
        missingExtensionPacks: ['pgvector'],
      });
    }
  });

  it('includes all missing extension packs in error meta', () => {
    const contractWithTwoPacks: Pick<ContractIR, 'targetFamily' | 'target' | 'extensionPacks'> = {
      targetFamily: 'sql',
      target: 'postgres',
      extensionPacks: {
        pgvector: {},
        other: {},
      },
    };

    try {
      assertContractRequirementsSatisfied({
        contract: contractWithTwoPacks,
        stack: createStack([]),
      });
      throw new Error('expected assertContractRequirementsSatisfied to throw');
    } catch (error) {
      if (!(error instanceof CliStructuredError)) {
        throw error;
      }

      expect(error.meta).toMatchObject({
        missingExtensionPacks: ['other', 'pgvector'],
      });
    }
  });
});
