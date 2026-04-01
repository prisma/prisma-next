import { describe, expect, it } from 'vitest';
import type { AuthoringTypeConstructorDescriptor } from '../src/framework-components';
import {
  instantiateAuthoringFieldPreset,
  instantiateAuthoringTypeConstructor,
} from '../src/framework-components';

describe('authoring template resolution', () => {
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
});
