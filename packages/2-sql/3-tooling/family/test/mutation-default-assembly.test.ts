import { describe, expect, it, vi } from 'vitest';
import type { SqlControlDescriptorWithContributions } from '../src/core/assembly';
import {
  assembleControlMutationDefaultContributions,
  assemblePslInterpretationContributions,
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
            {
              lower: () => ({
                ok: true as const,
                value: {
                  kind: 'storage' as const,
                  defaultValue: { kind: 'function' as const, expression: 'first()' },
                },
              }),
              usageSignatures: ['first_fn()'],
            },
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
            {
              lower: () => ({
                ok: true as const,
                value: {
                  kind: 'storage' as const,
                  defaultValue: { kind: 'function' as const, expression: 'second()' },
                },
              }),
              usageSignatures: ['second_fn()'],
            },
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
            {
              lower: () => ({
                ok: true as const,
                value: {
                  kind: 'storage' as const,
                  defaultValue: { kind: 'function' as const, expression: 'first()' },
                },
              }),
              usageSignatures: ['duplicate_fn()'],
            },
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
            {
              lower: () => ({
                ok: true as const,
                value: {
                  kind: 'storage' as const,
                  defaultValue: { kind: 'function' as const, expression: 'second()' },
                },
              }),
              usageSignatures: ['duplicate_fn()'],
            },
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

    expect(() => assembleControlMutationDefaultContributions([first, second])).toThrow(
      /Duplicate mutation default generator id "duplicate-generator"/,
    );
  });

  it('evaluates controlMutationDefaults() once per descriptor', () => {
    const spy = vi.fn(() => ({
      defaultFunctionRegistry: new Map(),
      generatorDescriptors: [{ id: 'gen-a', applicableCodecIds: ['pg/text@1'] }],
    }));

    const descriptor = createDescriptor('spied', { controlMutationDefaults: spy });

    assembleControlMutationDefaultContributions([descriptor]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('collects scalar type descriptor contributions', () => {
    const first = createDescriptor('first', {
      pslTypeDescriptors: () => ({
        scalarTypeDescriptors: new Map([
          ['String', { codecId: 'first/text@1', nativeType: 'text' }],
        ]),
      }),
    });
    const second = createDescriptor('second', {
      pslTypeDescriptors: () => ({
        scalarTypeDescriptors: new Map([
          ['Bytes', { codecId: 'first/bytes@1', nativeType: 'bytea' }],
        ]),
      }),
    });

    const contributions = assemblePslInterpretationContributions([first, second]);
    expect(contributions.scalarTypeDescriptors.get('String')).toMatchObject({
      codecId: 'first/text@1',
      nativeType: 'text',
    });
    expect(contributions.scalarTypeDescriptors.get('Bytes')).toMatchObject({
      codecId: 'first/bytes@1',
      nativeType: 'bytea',
    });
  });

  it('throws for duplicate scalar type descriptors', () => {
    const first = createDescriptor('first', {
      pslTypeDescriptors: () => ({
        scalarTypeDescriptors: new Map([
          ['String', { codecId: 'first/text@1', nativeType: 'text' }],
        ]),
      }),
    });
    const second = createDescriptor('second', {
      pslTypeDescriptors: () => ({
        scalarTypeDescriptors: new Map([
          ['String', { codecId: 'second/text@1', nativeType: 'text' }],
        ]),
      }),
    });

    expect(() => assemblePslInterpretationContributions([first, second])).toThrow(
      /Duplicate PSL scalar type descriptor "String"/,
    );
  });
});
