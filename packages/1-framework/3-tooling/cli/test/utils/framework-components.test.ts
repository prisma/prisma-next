import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import { CliStructuredError } from '@prisma-next/core-control-plane/errors';
import { describe, expect, it } from 'vitest';
import { assertFrameworkComponentsCompatible } from '../../src/utils/framework-components';

describe('assertFrameworkComponentsCompatible', () => {
  const createValidComponent = (
    kind: 'target' | 'adapter' | 'extension' | 'driver',
    familyId = 'sql',
    targetId = 'postgres',
  ): TargetBoundComponentDescriptor<'sql', 'postgres'> => ({
    kind,
    id: `${kind}-id`,
    familyId,
    targetId,
    manifest: { id: `${kind}-id`, version: '1.0.0' },
    create: () => ({}) as never,
  });

  it('validates and returns components when all are compatible', () => {
    const components = [
      createValidComponent('target'),
      createValidComponent('adapter'),
      createValidComponent('extension'),
      createValidComponent('driver'),
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
    const components = [createValidComponent('target', 'document', 'postgres')];

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
    const components = [createValidComponent('adapter', 'sql', 'mysql')];

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', components);
    }).toThrow(CliStructuredError);
  });

  it('validates all components in array', () => {
    const components = [
      createValidComponent('target'),
      createValidComponent('adapter', 'document', 'postgres'), // Wrong familyId
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
    const target = createValidComponent('target');
    const adapter = createValidComponent('adapter');
    const extension = createValidComponent('extension');
    const driver = createValidComponent('driver');

    expect(() => {
      assertFrameworkComponentsCompatible('sql', 'postgres', [target, adapter, extension, driver]);
    }).not.toThrow();
  });
});
