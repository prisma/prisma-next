import type {
  AuthoringFieldNamespace,
  AuthoringTypeNamespace,
} from '@prisma-next/framework-components/authoring';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import {
  createFieldHelpersFromNamespace,
  createFieldPresetHelper,
  createTypeHelpersFromNamespace,
  isNamedConstraintOptionsLike,
} from '../src/authoring-helper-runtime';
import { createComposedAuthoringHelpers } from '../src/composed-authoring-helpers';

const textPreset = {
  kind: 'fieldPreset',
  output: { codecId: 'sql/text@1', nativeType: 'text' },
} as const;

const createdAtPreset = {
  kind: 'fieldPreset',
  output: {
    codecId: 'sql/timestamp@1',
    nativeType: 'timestamp',
    default: { kind: 'function', expression: 'CURRENT_TIMESTAMP' },
  },
} as const;

const nanoidIdPreset = {
  kind: 'fieldPreset',
  args: [
    {
      kind: 'object',
      optional: true,
      properties: {
        size: { kind: 'number', optional: true, integer: true, minimum: 2, maximum: 255 },
      },
    },
  ],
  output: {
    codecId: 'sql/char@1',
    nativeType: 'character',
    typeParams: { length: { kind: 'arg', index: 0, path: ['size'], default: 21 } },
    executionDefault: {
      kind: 'generator',
      id: 'nanoid',
      params: { size: { kind: 'arg', index: 0, path: ['size'] } },
    },
    id: true,
  },
} as const;

const bareFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const bareTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const nestedTypeNamespace = {
  pgvector: {
    vector: {
      kind: 'typeConstructor',
      args: [{ kind: 'number', integer: true, minimum: 1, maximum: 2000 }],
      output: {
        codecId: 'pg/vector@1',
        nativeType: 'vector',
        typeParams: {
          length: { kind: 'arg', index: 0 },
        },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;

const nestedFieldNamespace = {
  audit: {
    createdAt: createdAtPreset,
  },
} as const satisfies AuthoringFieldNamespace;

const uniqueTextFieldNamespace = {
  slug: {
    ...textPreset,
    output: {
      ...textPreset.output,
      unique: true,
    },
  },
} as const satisfies AuthoringFieldNamespace;

function withBlockedKey<T extends object>(value: T): T {
  const unsafe = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(value)) {
    unsafe[key] = entry;
  }
  Object.defineProperty(unsafe, '__proto__', {
    enumerable: true,
    value: value,
  });
  return unsafe as T;
}

describe('authoring helper runtime', () => {
  it('recognizes valid named constraint option objects', () => {
    expect(isNamedConstraintOptionsLike({})).toBe(true);
    expect(isNamedConstraintOptionsLike({ name: 'user_pkey' })).toBe(true);
  });

  it('rejects invalid named constraint option shapes', () => {
    expect(isNamedConstraintOptionsLike(null)).toBe(false);
    expect(isNamedConstraintOptionsLike([])).toBe(false);
    expect(isNamedConstraintOptionsLike({ name: 123 })).toBe(false);
    expect(isNamedConstraintOptionsLike({ name: 'user_pkey', extra: true })).toBe(false);
  });

  it('creates nested type helpers and instantiates storage types', () => {
    const helpers = createTypeHelpersFromNamespace(nestedTypeNamespace) as {
      readonly pgvector: {
        readonly vector: (length: number) => {
          readonly codecId: string;
          readonly nativeType: string;
          readonly typeParams: { readonly length: number };
        };
      };
    };

    expect(helpers.pgvector.vector(1536)).toEqual({
      codecId: 'pg/vector@1',
      nativeType: 'vector',
      typeParams: { length: 1536 },
    });
  });

  it('rejects blocked path segments when building type helpers', () => {
    const unsafeNamespace = {
      nested: withBlockedKey({
        vector: nestedTypeNamespace.pgvector.vector,
      }),
    } as unknown as AuthoringTypeNamespace;

    expect(() => createTypeHelpersFromNamespace(unsafeNamespace)).toThrow(
      'Invalid authoring helper "nested.__proto__". Helper path segments must not use "__proto__".',
    );
  });

  it('creates nested field helpers and passes the resolved helper path to leaf factories', () => {
    const helpers = createFieldHelpersFromNamespace(
      nestedFieldNamespace,
      ({ helperPath }) =>
        () =>
          helperPath,
    ) as {
      readonly audit: {
        readonly createdAt: () => string;
      };
    };

    expect(helpers.audit.createdAt()).toBe('audit.createdAt');
  });

  it('rejects blocked path segments when building field helpers', () => {
    const unsafeNamespace = {
      nested: withBlockedKey({
        createdAt: createdAtPreset,
      }),
    } as unknown as AuthoringFieldNamespace;

    expect(() =>
      createFieldHelpersFromNamespace(
        unsafeNamespace,
        ({ helperPath }) =>
          () =>
            helperPath,
      ),
    ).toThrow(
      'Invalid authoring helper "nested.__proto__". Helper path segments must not use "__proto__".',
    );
  });

  it('passes optional named constraint options through field preset helpers', () => {
    const helper = createFieldPresetHelper({
      helperPath: 'field.id.nanoid',
      descriptor: nanoidIdPreset,
      build: ({ args, namedConstraintOptions }) => ({
        args,
        namedConstraintOptions,
      }),
    });

    expect(helper({ size: 16 }, { name: 'short_link_pkey' })).toEqual({
      args: [{ size: 16 }],
      namedConstraintOptions: { name: 'short_link_pkey' },
    });
  });

  it('rejects extra arguments for helpers that accept named constraint options', () => {
    const helper = createFieldPresetHelper({
      helperPath: 'field.id.nanoid',
      descriptor: nanoidIdPreset,
      build: ({ args, namedConstraintOptions }) => ({
        args,
        namedConstraintOptions,
      }),
    });

    expect(() => helper({ size: 16 }, { name: 'short_link_pkey' }, { name: 'ignored' })).toThrow(
      'field.id.nanoid expects at most 2 argument(s), received 3',
    );
  });

  it('rejects malformed named constraint option objects', () => {
    const helper = createFieldPresetHelper({
      helperPath: 'field.id.nanoid',
      descriptor: nanoidIdPreset,
      build: ({ args, namedConstraintOptions }) => ({
        args,
        namedConstraintOptions,
      }),
    });

    expect(() => helper({ size: 16 }, { invalid: true } as never)).toThrow(
      'field.id.nanoid accepts an optional trailing { name?: string } constraint options object',
    );
  });
});

describe('createComposedAuthoringHelpers', () => {
  it('builds custom unique field helpers and keeps core helpers available', () => {
    const slugPack = {
      kind: 'extension',
      id: 'slug-pack',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      authoring: {
        field: uniqueTextFieldNamespace,
      },
    } as const satisfies ExtensionPackRef<'sql', 'postgres'>;

    const helpers = createComposedAuthoringHelpers({
      family: bareFamilyPack,
      target: bareTargetPack,
      extensionPacks: {
        slugPack,
      },
    });

    const slugState = helpers.field.slug({ name: 'post_slug_key' }).build();
    expect(slugState.unique).toEqual({ name: 'post_slug_key' });
    expect(helpers.field.column).toBeDefined();
    expect(helpers.type).toEqual({});
  });

  it('rejects duplicate nested type helper paths across composed packs', () => {
    const targetPack = {
      ...bareTargetPack,
      authoring: {
        type: nestedTypeNamespace,
      },
    } as const satisfies TargetPackRef<'sql', 'postgres'>;

    const conflictingPack = {
      kind: 'extension',
      id: 'conflicting-pack',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      authoring: {
        type: nestedTypeNamespace,
      },
    } as const satisfies ExtensionPackRef<'sql', 'postgres'>;

    expect(() =>
      createComposedAuthoringHelpers({
        family: bareFamilyPack,
        target: targetPack,
        extensionPacks: {
          conflictingPack,
        },
      }),
    ).toThrow(
      'Duplicate authoring type helper "pgvector.vector". Helper names must be unique across composed packs.',
    );
  });

  it('rejects extension helpers that collide with reserved core field helper names', () => {
    const reservedFieldPack = {
      kind: 'extension',
      id: 'reserved-field-pack',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      authoring: {
        field: {
          column: textPreset,
        },
      },
    } as const satisfies ExtensionPackRef<'sql', 'postgres'>;

    expect(() =>
      createComposedAuthoringHelpers({
        family: bareFamilyPack,
        target: bareTargetPack,
        extensionPacks: {
          reservedFieldPack,
        },
      }),
    ).toThrow('Duplicate authoring field helper "column". Core field helpers reserve that name.');
  });
});
