import { CliStructuredError } from '@prisma-next/core-control-plane/errors';
import { describe, expect, it } from 'vitest';
import { assertFrameworkComponentsCompatible } from '../../src/utils/framework-components';

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
    version: '1.0.0',
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
