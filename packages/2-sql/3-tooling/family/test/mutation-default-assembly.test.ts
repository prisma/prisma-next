import { describe, expect, it } from 'vitest';
import type { SqlControlDescriptorWithContributions } from '../src/core/assembly';
import {
  assembleControlMutationDefaultContributions,
  createControlMutationDefaultGeneratorDescriptorMap,
} from '../src/core/assembly';

function createDescriptor(
  id: string,
  options?: Partial<SqlControlDescriptorWithContributions>,
): SqlControlDescriptorWithContributions {
  return {
    id,
    operationSignatures: () => [],
    ...options,
  };
}

describe('assembleControlMutationDefaultContributions', () => {
  it('collects deterministic function and generator contributions', () => {
    const first = createDescriptor('first', {
      controlMutationDefaults: () => ({
        defaultFunctionRegistry: new Map([
          [
            'first_fn',
            () => ({
              ok: true as const,
              value: {
                kind: 'storage' as const,
                defaultValue: { kind: 'function' as const, expression: 'first()' },
              },
            }),
          ],
        ]),
        generatorDescriptors: [
          {
            id: 'first-generator',
            applicableCodecIds: ['pg/text@1'],
          },
        ],
      }),
    });

    const second = createDescriptor('second', {
      controlMutationDefaults: () => ({
        defaultFunctionRegistry: new Map([
          [
            'second_fn',
            () => ({
              ok: true as const,
              value: {
                kind: 'storage' as const,
                defaultValue: { kind: 'function' as const, expression: 'second()' },
              },
            }),
          ],
        ]),
        generatorDescriptors: [
          {
            id: 'second-generator',
            applicableCodecIds: ['pg/text@1'],
          },
        ],
      }),
    });

    const contributions = assembleControlMutationDefaultContributions([first, second]);

    expect(Array.from(contributions.defaultFunctionRegistry.keys())).toEqual([
      'first_fn',
      'second_fn',
    ]);
    expect(contributions.generatorDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'first-generator',
      'second-generator',
    ]);
  });

  it('throws for duplicate default function names', () => {
    const first = createDescriptor('first', {
      controlMutationDefaults: () => ({
        defaultFunctionRegistry: new Map([
          [
            'duplicate_fn',
            () => ({
              ok: true as const,
              value: {
                kind: 'storage' as const,
                defaultValue: { kind: 'function' as const, expression: 'first()' },
              },
            }),
          ],
        ]),
        generatorDescriptors: [],
      }),
    });
    const second = createDescriptor('second', {
      controlMutationDefaults: () => ({
        defaultFunctionRegistry: new Map([
          [
            'duplicate_fn',
            () => ({
              ok: true as const,
              value: {
                kind: 'storage' as const,
                defaultValue: { kind: 'function' as const, expression: 'second()' },
              },
            }),
          ],
        ]),
        generatorDescriptors: [],
      }),
    });

    expect(() => assembleControlMutationDefaultContributions([first, second])).toThrow(
      /Duplicate mutation default function "duplicate_fn"/,
    );
  });

  it('throws for duplicate generator ids', () => {
    const first = createDescriptor('first', {
      controlMutationDefaults: () => ({
        defaultFunctionRegistry: new Map(),
        generatorDescriptors: [
          {
            id: 'duplicate-generator',
            applicableCodecIds: ['pg/text@1'],
          },
        ],
      }),
    });
    const second = createDescriptor('second', {
      controlMutationDefaults: () => ({
        defaultFunctionRegistry: new Map(),
        generatorDescriptors: [
          {
            id: 'duplicate-generator',
            applicableCodecIds: ['pg/int4@1'],
          },
        ],
      }),
    });

    expect(() => createControlMutationDefaultGeneratorDescriptorMap([first, second])).toThrow(
      /Duplicate mutation default generator id "duplicate-generator"/,
    );
  });
});
