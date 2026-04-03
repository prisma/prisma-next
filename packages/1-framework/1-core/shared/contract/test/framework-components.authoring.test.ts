import { describe, expect, it } from 'vitest';
import type { AuthoringTypeConstructorDescriptor } from '../src/framework-authoring';
import {
  instantiateAuthoringFieldPreset,
  instantiateAuthoringTypeConstructor,
  isAuthoringArgRef,
  isAuthoringFieldPresetDescriptor,
  isAuthoringTypeConstructorDescriptor,
  resolveAuthoringTemplateValue,
  validateAuthoringHelperArguments,
} from '../src/framework-authoring';

describe('authoring template resolution', () => {
  it('detects authoring descriptor kinds', () => {
    expect(
      isAuthoringTypeConstructorDescriptor({
        kind: 'typeConstructor',
        output: { codecId: 'test/text@1', nativeType: 'text' },
      }),
    ).toBe(true);
    expect(isAuthoringTypeConstructorDescriptor({ kind: 'fieldPreset' })).toBe(false);

    expect(
      isAuthoringFieldPresetDescriptor({
        kind: 'fieldPreset',
        output: { codecId: 'test/text@1', nativeType: 'text' },
      }),
    ).toBe(true);
    expect(isAuthoringFieldPresetDescriptor({ kind: 'typeConstructor' })).toBe(false);
  });

  it('rejects descriptors without output property', () => {
    expect(isAuthoringTypeConstructorDescriptor({ kind: 'typeConstructor' })).toBe(false);
    expect(isAuthoringFieldPresetDescriptor({ kind: 'fieldPreset' })).toBe(false);
  });

  it('rejects arg refs with invalid index or path', () => {
    expect(isAuthoringArgRef({ kind: 'arg', index: 0 })).toBe(true);
    expect(isAuthoringArgRef({ kind: 'arg', index: 0, path: ['a', 'b'] })).toBe(true);

    expect(isAuthoringArgRef({ kind: 'arg', index: -1 })).toBe(false);
    expect(isAuthoringArgRef({ kind: 'arg', index: 1.5 })).toBe(false);
    expect(isAuthoringArgRef({ kind: 'arg', index: Number.NaN })).toBe(false);
    expect(isAuthoringArgRef({ kind: 'arg', index: 0, path: [1] })).toBe(false);
    expect(isAuthoringArgRef({ kind: 'arg', index: 0, path: 'not-array' })).toBe(false);
  });

  it('resolves array template values', () => {
    expect(
      resolveAuthoringTemplateValue(
        [
          {
            kind: 'arg',
            index: 0,
          },
          {
            kind: 'arg',
            index: 1,
            default: 'fallback',
          },
        ],
        ['value'],
      ),
    ).toEqual(['value', 'fallback']);
  });

  it('validates supported helper argument kinds', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [
          { kind: 'string' },
          { kind: 'stringArray' },
          {
            kind: 'object',
            properties: {
              label: { kind: 'string' },
              length: { kind: 'number', integer: true, minimum: 1, maximum: 3 },
            },
          },
          { kind: 'number', optional: true, minimum: 0 },
        ],
        ['vector', ['a', 'b'], { label: 'embedding', length: 2 }, 0],
      ),
    ).not.toThrow();
  });

  it('allows omitted optional helper arguments', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'string' }, { kind: 'number', optional: true }],
        ['name'],
      ),
    ).not.toThrow();
  });

  it('rejects missing required helper arguments', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'object', properties: { label: { kind: 'string' } } }],
        [{}],
      ),
    ).toThrow(/Missing required authoring helper argument at field\.test\[0\]\.label/);
  });

  it('rejects malformed helper argument values', () => {
    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'string' }], [123]),
    ).toThrow(/must be a string/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'stringArray' }], [['ok', 1]]),
    ).toThrow(/must be an array of strings/);

    const sparseArray = new Array(2);
    sparseArray[1] = 'id';
    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'stringArray' }], [sparseArray]),
    ).toThrow(/must be an array of strings/);

    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'object', properties: { label: { kind: 'string' } } }],
        ['not-an-object'],
      ),
    ).toThrow(/must be an object/);

    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'object', properties: { label: { kind: 'string' } } }],
        [{ label: 'ok', extra: true }],
      ),
    ).toThrow(/contains unknown property "extra"/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'number' }], ['x']),
    ).toThrow(/must be a number/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'number', integer: true }], [1.5]),
    ).toThrow(/must be an integer/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'number', minimum: 2 }], [1]),
    ).toThrow(/must be >= 2, received 1/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'number', maximum: 2 }], [3]),
    ).toThrow(/must be <= 2, received 3/);
  });

  it('rejects invalid helper argument counts', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'string' }, { kind: 'number', optional: true }],
        [],
      ),
    ).toThrow(/expects 1-2 argument\(s\), received 0/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'string' }], ['a', 'b']),
    ).toThrow(/expects 1 argument\(s\), received 2/);
  });

  it('computes minimum arity from last required slot, not count of required slots', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'number', optional: true }, { kind: 'string' }],
        [],
      ),
    ).toThrow(/expects 2 argument\(s\), received 0/);

    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'number', optional: true }, { kind: 'string' }],
        [42],
      ),
    ).toThrow(/expects 2 argument\(s\), received 1/);

    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'number', optional: true }, { kind: 'string' }],
        [42, 'hello'],
      ),
    ).not.toThrow();
  });

  it('ignores prototype-chain values when resolving arg paths', () => {
    const descriptor = {
      kind: 'typeConstructor',
      output: {
        codecId: 'test/text@1',
        nativeType: {
          kind: 'arg',
          index: 0,
          path: ['nativeType'],
          default: 'text',
        },
      },
    } as const;

    const args = [Object.create({ nativeType: 'prototype-text' })];

    expect(instantiateAuthoringTypeConstructor(descriptor, args)).toEqual({
      codecId: 'test/text@1',
      nativeType: 'text',
    });
  });

  it('rejects resolved nativeType values that are not strings', () => {
    const descriptor = {
      kind: 'typeConstructor',
      output: {
        codecId: 'test/text@1',
        nativeType: {
          kind: 'arg',
          index: 0,
        },
      },
    } as const;

    expect(() => instantiateAuthoringTypeConstructor(descriptor, [123])).toThrow(
      /Resolved authoring nativeType must be a string/,
    );
  });

  it('rejects malformed resolved typeParams values', () => {
    const descriptor = {
      kind: 'typeConstructor',
      output: {
        codecId: 'test/vector@1',
        nativeType: 'vector',
        typeParams: {
          kind: 'arg',
          index: 0,
        },
      },
      // Intentional test-only double-cast to inject malformed runtime shape.
    } as unknown as AuthoringTypeConstructorDescriptor;

    expect(() => instantiateAuthoringTypeConstructor(descriptor, ['not-an-object'])).toThrow(
      /Resolved authoring typeParams must be an object/,
    );
  });

  it('rejects object-valued function default expressions', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/text@1',
        nativeType: 'text',
        default: {
          kind: 'function',
          expression: {
            kind: 'arg',
            index: 0,
          },
        },
      },
    } as const;

    expect(() =>
      instantiateAuthoringFieldPreset(descriptor, [{ sql: 'CURRENT_TIMESTAMP' }]),
    ).toThrow(/Resolved authoring function default expression must resolve to a primitive/);
  });

  it('rejects literal defaults that resolve to undefined', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/text@1',
        nativeType: 'text',
        default: {
          kind: 'literal',
          value: {
            kind: 'arg',
            index: 0,
            path: ['missing'],
          },
        },
      },
    } as const;

    expect(() => instantiateAuthoringFieldPreset(descriptor, [{}])).toThrow(
      /Resolved authoring literal default must not be undefined/,
    );
  });

  it('resolves literal defaults and execution defaults from field presets', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/vector@1',
        nativeType: 'vector',
        typeParams: {
          length: {
            kind: 'arg',
            index: 0,
          },
        },
        default: {
          kind: 'literal',
          value: {
            length: {
              kind: 'arg',
              index: 0,
            },
          },
        },
        executionDefault: {
          kind: 'arg',
          index: 1,
          path: ['id'],
        },
        nullable: true,
        id: true,
        unique: true,
      },
    } as const;

    expect(instantiateAuthoringFieldPreset(descriptor, [1536, { id: 'generated' }])).toEqual({
      descriptor: {
        codecId: 'test/vector@1',
        nativeType: 'vector',
        typeParams: { length: 1536 },
      },
      nullable: true,
      default: {
        kind: 'literal',
        value: {
          length: 1536,
        },
      },
      executionDefault: 'generated',
      id: true,
      unique: true,
    });
  });

  it('stringifies primitive function default expressions', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/text@1',
        nativeType: 'text',
        default: {
          kind: 'function',
          expression: {
            kind: 'arg',
            index: 0,
          },
        },
      },
    } as const;

    expect(instantiateAuthoringFieldPreset(descriptor, [123]).default).toEqual({
      kind: 'function',
      expression: '123',
    });
  });
});
