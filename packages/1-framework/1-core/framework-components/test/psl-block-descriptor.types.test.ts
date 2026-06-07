import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AuthoringContributions,
  AuthoringPslBlockDescriptor,
} from '../src/shared/framework-authoring';
import { isAuthoringPslBlockDescriptor } from '../src/shared/framework-authoring';
import type {
  PslBlockParam,
  PslBlockParamList,
  PslBlockParamOption,
  PslBlockParamRef,
  PslBlockParamValue,
} from '../src/shared/psl-extension-block';

describe('PslBlockParam discriminated union', () => {
  it('four kinds cover the union exhaustively', () => {
    function assertExhaustive(param: PslBlockParam): string {
      switch (param.kind) {
        case 'ref':
          return param.refKind;
        case 'value':
          return param.codecId;
        case 'option':
          return param.values[0] ?? '';
        case 'list':
          return assertExhaustive(param.of);
      }
    }
    expectTypeOf(assertExhaustive).toBeFunction();
  });

  it('ref narrows to PslBlockParamRef', () => {
    const param = { kind: 'ref', refKind: 'model', scope: 'same-namespace' } as const;
    expectTypeOf(param).toMatchTypeOf<PslBlockParamRef>();
    expectTypeOf(param.refKind).toEqualTypeOf<'model'>();
    expectTypeOf(param.scope).toEqualTypeOf<'same-namespace'>();
  });

  it('value narrows to PslBlockParamValue', () => {
    const param = { kind: 'value', codecId: 'String' } as const;
    expectTypeOf(param).toMatchTypeOf<PslBlockParamValue>();
    expectTypeOf(param.codecId).toEqualTypeOf<'String'>();
  });

  it('option narrows to PslBlockParamOption', () => {
    const param = { kind: 'option', values: ['permissive', 'restrictive'] as const } as const;
    expectTypeOf(param).toMatchTypeOf<PslBlockParamOption>();
  });

  it('list narrows to PslBlockParamList and allows nesting', () => {
    const param = {
      kind: 'list',
      of: { kind: 'ref', refKind: 'role', scope: 'cross-space' },
    } as const;
    expectTypeOf(param).toMatchTypeOf<PslBlockParamList>();
    expectTypeOf(param.of).toMatchTypeOf<PslBlockParamRef>();
  });
});

describe('AuthoringPslBlockDescriptor', () => {
  it('a valid declarative descriptor literal satisfies the type', () => {
    const descriptor = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      parameters: {
        target: { kind: 'ref', refKind: 'model', scope: 'same-namespace', required: true },
        as: { kind: 'option', values: ['permissive', 'restrictive'], required: false },
        roles: {
          kind: 'list',
          of: { kind: 'ref', refKind: 'role', scope: 'cross-space' },
          required: false,
        },
        using: { kind: 'value', codecId: 'String', required: true },
      },
    } satisfies AuthoringPslBlockDescriptor;

    expectTypeOf(descriptor.kind).toEqualTypeOf<'pslBlock'>();
    expectTypeOf(descriptor.keyword).toEqualTypeOf<string>();
    expectTypeOf(descriptor.discriminator).toEqualTypeOf<string>();
  });

  it('a descriptor with a parser function field does NOT satisfy the type', () => {
    const base = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      parameters: {},
    };
    const withParser = {
      ...base,
      // @ts-expect-error — parser is not part of the declarative descriptor shape
      parser: () => ({ kind: 'postgres-policy-select', name: 'x', parameters: {}, span: {} }),
    } satisfies AuthoringPslBlockDescriptor;
    void withParser;
  });

  it('a descriptor with a printer function field does NOT satisfy the type', () => {
    const base = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      parameters: {},
    };
    const withPrinter = {
      ...base,
      // @ts-expect-error — printer is not part of the declarative descriptor shape
      printer: () => '',
    } satisfies AuthoringPslBlockDescriptor;
    void withPrinter;
  });

  it('AuthoringContributions accepts a pslBlocks namespace', () => {
    const contributions: AuthoringContributions = {
      pslBlocks: {
        policySelect: {
          kind: 'pslBlock',
          keyword: 'policy_select',
          discriminator: 'postgres-policy-select',
          name: { required: true },
          parameters: {
            target: { kind: 'ref', refKind: 'model', scope: 'same-namespace', required: true },
          },
        },
      },
    };
    expectTypeOf(contributions.pslBlocks).not.toBeUndefined();
  });
});

describe('isAuthoringPslBlockDescriptor', () => {
  it('returns true for a valid declarative descriptor', () => {
    const result = isAuthoringPslBlockDescriptor({
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      parameters: { target: { kind: 'ref', refKind: 'model', scope: 'same-namespace' } },
    });
    expect(result).toBe(true);
  });

  it('returns false when kind is not pslBlock', () => {
    expect(isAuthoringPslBlockDescriptor({ kind: 'entity', discriminator: 'x' })).toBe(false);
  });

  it('returns false when keyword is missing', () => {
    expect(
      isAuthoringPslBlockDescriptor({
        kind: 'pslBlock',
        discriminator: 'x',
        name: { required: true },
        parameters: {},
      }),
    ).toBe(false);
  });

  it('returns false when discriminator is missing', () => {
    expect(
      isAuthoringPslBlockDescriptor({
        kind: 'pslBlock',
        keyword: 'policy_select',
        name: { required: true },
        parameters: {},
      }),
    ).toBe(false);
  });

  it('returns false when name is missing', () => {
    expect(
      isAuthoringPslBlockDescriptor({
        kind: 'pslBlock',
        keyword: 'policy_select',
        discriminator: 'x',
        parameters: {},
      }),
    ).toBe(false);
  });

  it('returns false when parameters is missing', () => {
    expect(
      isAuthoringPslBlockDescriptor({
        kind: 'pslBlock',
        keyword: 'policy_select',
        discriminator: 'x',
        name: { required: true },
      }),
    ).toBe(false);
  });

  it('returns false for a function-based (old-style) descriptor', () => {
    expect(
      isAuthoringPslBlockDescriptor({
        kind: 'pslBlock',
        discriminator: 'x',
        parser: () => ({}),
        printer: () => '',
      }),
    ).toBe(false);
  });

  it('narrows the type when it returns true', () => {
    const unknown: unknown = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      parameters: {},
    };
    if (isAuthoringPslBlockDescriptor(unknown)) {
      expectTypeOf(unknown).toEqualTypeOf<AuthoringPslBlockDescriptor>();
    }
  });
});
