import { describe, expect, it } from 'vitest';
import type {
  AuthoringFieldNamespace,
  AuthoringFieldPresetDescriptor,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '../src/shared/framework-authoring';
import {
  classifyEnumMemberType,
  hasRegisteredFieldNamespace,
  instantiateAuthoringFieldPreset,
  instantiateAuthoringTypeConstructor,
  isAuthoringArgRef,
  isAuthoringFieldPresetDescriptor,
  isAuthoringTypeConstructorDescriptor,
  resolveAuthoringTemplateValue,
  validateAuthoringHelperArguments,
} from '../src/shared/framework-authoring';
import type {
  PslExtensionBlock,
  PslExtensionBlockParamValue,
} from '../src/shared/psl-extension-block';

describe('authoring template resolution', () => {
  const typeConstructor = {
    kind: 'typeConstructor',
    output: { codecId: 'test/text@1', nativeType: 'text' },
  } satisfies AuthoringTypeConstructorDescriptor;
  const fieldPreset = {
    kind: 'fieldPreset',
    output: { codecId: 'test/text@1', nativeType: 'text' },
  } satisfies AuthoringFieldPresetDescriptor;

  it('narrows a descriptor by kind', () => {
    expect(isAuthoringTypeConstructorDescriptor(typeConstructor)).toBe(true);
    expect(isAuthoringFieldPresetDescriptor(fieldPreset)).toBe(true);
  });

  it('classifies a sub-namespace as not a descriptor', () => {
    const typeNamespace = { nested: typeConstructor } satisfies AuthoringTypeNamespace;
    const fieldNamespace = { nested: fieldPreset } satisfies AuthoringFieldNamespace;
    expect(isAuthoringTypeConstructorDescriptor(typeNamespace)).toBe(false);
    expect(isAuthoringFieldPresetDescriptor(fieldNamespace)).toBe(false);
  });

  describe('hasRegisteredFieldNamespace', () => {
    const presetLeaf = {
      kind: 'fieldPreset',
      output: { codecId: 'test/text@1', nativeType: 'text' },
    } as const;

    it('returns true for a non-leaf namespace key', () => {
      expect(
        hasRegisteredFieldNamespace({ field: { temporal: { createdAt: presetLeaf } } }, 'temporal'),
      ).toBe(true);
    });

    it('returns true for an empty sub-namespace', () => {
      expect(hasRegisteredFieldNamespace({ field: { temporal: {} } }, 'temporal')).toBe(true);
    });

    it('returns false for a leaf preset registered at the root', () => {
      expect(hasRegisteredFieldNamespace({ field: { temporal: presetLeaf } }, 'temporal')).toBe(
        false,
      );
    });

    it('returns false for missing contributions or unknown key', () => {
      expect(hasRegisteredFieldNamespace(undefined, 'temporal')).toBe(false);
      expect(hasRegisteredFieldNamespace({}, 'temporal')).toBe(false);
      expect(hasRegisteredFieldNamespace({ field: {} }, 'temporal')).toBe(false);
    });
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
        executionDefaults: {
          onCreate: {
            kind: 'arg',
            index: 1,
          },
        },
        nullable: true,
        id: true,
        unique: true,
      },
    } as const;

    expect(
      instantiateAuthoringFieldPreset(descriptor, [
        1536,
        { kind: 'generator', id: 'vectorGenerated' },
      ]),
    ).toEqual({
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
      executionDefaults: {
        onCreate: { kind: 'generator', id: 'vectorGenerated' },
      },
      id: true,
      unique: true,
    });
  });

  it('resolves phase-specific execution defaults from field presets', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/timestamp@1',
        nativeType: 'timestamp',
        executionDefaults: {
          onCreate: {
            kind: 'arg',
            index: 0,
            path: ['create'],
          },
          onUpdate: {
            kind: 'arg',
            index: 0,
            path: ['update'],
          },
        },
      },
    } as const;

    expect(
      instantiateAuthoringFieldPreset(descriptor, [
        {
          create: { kind: 'generator', id: 'timestampNow' },
          update: { kind: 'generator', id: 'timestampNow' },
        },
      ]),
    ).toEqual({
      descriptor: {
        codecId: 'test/timestamp@1',
        nativeType: 'timestamp',
      },
      nullable: false,
      executionDefaults: {
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
      id: false,
      unique: false,
    });
  });

  it('rejects executionDefaults phases that resolve to non-generator values', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/timestamp@1',
        nativeType: 'timestamp',
        executionDefaults: {
          onCreate: {
            kind: 'arg',
            index: 0,
          },
        },
      },
    } as const;

    expect(() => instantiateAuthoringFieldPreset(descriptor, ['not-a-generator'])).toThrow(
      /Authoring preset executionDefaults\.onCreate did not resolve to a valid generator descriptor/,
    );
  });

  it('rejects executionDefaults phases whose generator id is not a string', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/timestamp@1',
        nativeType: 'timestamp',
        executionDefaults: {
          onUpdate: {
            kind: 'arg',
            index: 0,
          },
        },
      },
    } as const;

    expect(() =>
      instantiateAuthoringFieldPreset(descriptor, [{ kind: 'generator', id: 42 }]),
    ).toThrow(
      /Authoring preset executionDefaults\.onUpdate did not resolve to a valid generator descriptor/,
    );
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

describe('classifyEnumMemberType', () => {
  const testSpan = {
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 0, line: 1, column: 1 },
  };

  function testBlock(parameters: Record<string, PslExtensionBlockParamValue>): PslExtensionBlock {
    return {
      kind: 'enum',
      keyword: 'enum',
      name: 'TestEnum',
      parameters,
      blockAttributes: [],
      span: testSpan,
    };
  }

  const bare: PslExtensionBlockParamValue = { kind: 'bare', span: testSpan };
  const value = (raw: string): PslExtensionBlockParamValue => ({
    kind: 'value',
    raw,
    span: testSpan,
  });
  const ref: PslExtensionBlockParamValue = { kind: 'ref', identifier: 'Foo', span: testSpan };
  const option: PslExtensionBlockParamValue = { kind: 'option', token: 'Foo', span: testSpan };
  const list: PslExtensionBlockParamValue = { kind: 'list', items: [], span: testSpan };

  it('classifies all-bare members as text', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: bare, User: bare }))).toBe('text');
  });

  it('classifies all-string-value members as text', () => {
    expect(
      classifyEnumMemberType(testBlock({ Admin: value('"admin"'), User: value('"user"') })),
    ).toBe('text');
  });

  it('classifies a mix of bare and string-value members as text', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: bare, User: value('"user"') }))).toBe('text');
  });

  it('classifies all-integer-value members as int', () => {
    expect(classifyEnumMemberType(testBlock({ Low: value('1'), High: value('10') }))).toBe('int');
  });

  it('returns null for a float value', () => {
    expect(classifyEnumMemberType(testBlock({ Low: value('1.5') }))).toBeNull();
  });

  it('returns null for a boolean value', () => {
    expect(classifyEnumMemberType(testBlock({ Flag: value('true') }))).toBeNull();
  });

  it('returns null for a mix of string and integer values', () => {
    expect(
      classifyEnumMemberType(testBlock({ Low: value('1'), High: value('"high"') })),
    ).toBeNull();
  });

  it('returns null for a mix of bare and integer values', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: bare, Low: value('1') }))).toBeNull();
  });

  it('returns null for a ref parameter', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: ref }))).toBeNull();
  });

  it('returns null for an option parameter', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: option }))).toBeNull();
  });

  it('returns null for a list parameter', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: list }))).toBeNull();
  });

  it('returns null for invalid JSON in a value parameter', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: value('notjson') }))).toBeNull();
  });

  it('returns null for an enum with no members', () => {
    expect(classifyEnumMemberType(testBlock({}))).toBeNull();
  });
});
