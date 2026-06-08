/**
 * Tests for the generic framework printer for extension-contributed PSL blocks (P2, TML-2854).
 *
 * The printer reads the descriptor's `parameters` map and renders each block
 * generically — no contributed `printer` function. Four parameter kinds:
 *   - `ref`    → identifier token
 *   - `value`  → codec JSON medium round-trip via `encodeJson(decodeJson(JSON.parse(raw)))`
 *   - `option` → literal token
 *   - `list`   → bracketed comma-separated rendered elements
 *
 * Exercises:
 *   1. A `policy_select` node with all four parameter kinds renders to the expected PSL text.
 *   2. A node whose discriminator has no registered descriptor throws.
 *   3. Built-in print round-trip is unchanged (enums, models).
 */

import type { JsonValue } from '@prisma-next/contract/types';
import {
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  voidParamsSchema,
} from '@prisma-next/framework-components/codec';
import {
  assembleAuthoringContributions,
  extractCodecLookup,
} from '@prisma-next/framework-components/control';
import type {
  PslExtensionBlock,
  PslExtensionBlockParamList,
  PslExtensionBlockParamOption,
  PslExtensionBlockParamRef,
  PslExtensionBlockParamScalarValue,
} from '@prisma-next/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import {
  declarativePolicySelectContributions,
  FIXTURE_POLICY_CODEC_ID,
} from './fixtures/declarative-policy-select-extension';

// ---------------------------------------------------------------------------
// Stub codec — matches the one in the round-trip test
// ---------------------------------------------------------------------------

class StubPolicyTextCodec extends CodecImpl<
  typeof FIXTURE_POLICY_CODEC_ID,
  readonly ['textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

class StubPolicyTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = FIXTURE_POLICY_CODEC_ID as typeof FIXTURE_POLICY_CODEC_ID;
  override readonly traits = ['textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => StubPolicyTextCodec {
    return () => new StubPolicyTextCodec(this);
  }
}

const stubDescriptor = new StubPolicyTextDescriptor();

const codecLookup = extractCodecLookup([
  {
    id: 'fixture-policy-ext',
    types: { codecTypes: { codecDescriptors: [stubDescriptor] } },
  },
]);

const assembled = assembleAuthoringContributions([
  { authoring: declarativePolicySelectContributions },
]);

// ---------------------------------------------------------------------------
// Helpers to build minimal PslExtensionBlock nodes for printer tests
// ---------------------------------------------------------------------------

const STUB_SPAN = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 1, line: 1, column: 2 },
} as const;

function refParam(identifier: string): PslExtensionBlockParamRef {
  return { kind: 'ref', identifier, span: STUB_SPAN };
}

function valueParam(raw: string): PslExtensionBlockParamScalarValue {
  return { kind: 'value', raw, span: STUB_SPAN };
}

function optionParam(token: string): PslExtensionBlockParamOption {
  return { kind: 'option', token, span: STUB_SPAN };
}

function listParam(items: readonly PslExtensionBlockParamRef[]): PslExtensionBlockParamList {
  return { kind: 'list', items, span: STUB_SPAN };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generic extension-block printer (P2)', () => {
  describe('policy_select block with ref, value, option, and list parameters', () => {
    it('renders all four parameter kinds to the expected PSL text', () => {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        name: 'ProfilesSelect',
        parameters: {
          target: refParam('Post'),
          as: optionParam('permissive'),
          roles: listParam([refParam('AdminRole'), refParam('EditorRole')]),
          using: valueParam('"auth.uid() = author_id"'),
        },
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [
          {
            kind: 'namespace' as const,
            name: UNSPECIFIED_PSL_NAMESPACE_ID,
            models: [],
            enums: [],
            compositeTypes: [],
            extensionBlocks: [block],
            span: STUB_SPAN,
          },
        ],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(output).toContain('policy_select ProfilesSelect {');
      expect(output).toContain('  target = Post');
      expect(output).toContain('  as = permissive');
      expect(output).toContain('  roles = [AdminRole, EditorRole]');
      expect(output).toContain('  using = "auth.uid() = author_id"');
      expect(output).toContain('}');
    });

    it('renders a block with only required parameters (omits absent optional params)', () => {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        name: 'MinimalSelect',
        parameters: {
          target: refParam('User'),
          using: valueParam('"true"'),
        },
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [
          {
            kind: 'namespace' as const,
            name: UNSPECIFIED_PSL_NAMESPACE_ID,
            models: [],
            enums: [],
            compositeTypes: [],
            extensionBlocks: [block],
            span: STUB_SPAN,
          },
        ],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast, {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(output).toContain('policy_select MinimalSelect {');
      expect(output).toContain('  target = User');
      expect(output).toContain('  using = "true"');
      expect(output).not.toContain('as =');
      expect(output).not.toContain('roles =');
    });
  });

  // The codec — not the captured raw text — owns the serialized form of a value
  // parameter. This is the print-back mirror of Slice 1's parse-side validator
  // (`decodeJson(JSON.parse(raw))`): printing runs the value through the codec's
  // JSON medium, `JSON.stringify(encodeJson(decodeJson(JSON.parse(raw))))`. The
  // identity stub codec above can't distinguish "echo the raw" from "round-trip
  // through the codec", so this block uses a codec whose encodeJson produces a
  // different JSON shape than the raw input — a value that came from an IR/value
  // source rather than parsed text would be serialized the same way.
  describe('value parameter serialized through the codec (not echoed from raw)', () => {
    class NumericExpressionCodec extends CodecImpl<
      typeof FIXTURE_POLICY_CODEC_ID,
      readonly ['numeric'],
      number,
      number
    > {
      async encode(value: number, _ctx: CodecCallContext): Promise<number> {
        return value;
      }
      async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
        return wire;
      }
      // A quoted "42" or a bare 42 both decode to the number 42 …
      decodeJson(json: JsonValue): number {
        return typeof json === 'number' ? json : Number(json);
      }
      // … and re-encode to a bare JSON number, which prints unquoted.
      encodeJson(value: number): JsonValue {
        return value;
      }
    }

    class NumericExpressionDescriptor extends CodecDescriptorImpl<void> {
      override readonly codecId = FIXTURE_POLICY_CODEC_ID as typeof FIXTURE_POLICY_CODEC_ID;
      override readonly traits = ['numeric'] as const;
      override readonly targetTypes = ['numeric'] as const;
      override readonly paramsSchema = voidParamsSchema;
      override factory(): (ctx: CodecInstanceContext) => NumericExpressionCodec {
        return () => new NumericExpressionCodec(this);
      }
    }

    const numericCodecLookup = extractCodecLookup([
      {
        id: 'fixture-policy-ext',
        types: { codecTypes: { codecDescriptors: [new NumericExpressionDescriptor()] } },
      },
    ]);

    function printUsing(raw: string): string {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        name: 'NumericPolicy',
        parameters: {
          target: refParam('Post'),
          using: valueParam(raw),
        },
        span: STUB_SPAN,
      };
      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [
          {
            kind: 'namespace' as const,
            name: UNSPECIFIED_PSL_NAMESPACE_ID,
            models: [],
            enums: [],
            compositeTypes: [],
            extensionBlocks: [block],
            span: STUB_SPAN,
          },
        ],
        span: STUB_SPAN,
      };
      return printPslFromAst(ast, {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup: numericCodecLookup,
      });
    }

    it('renders the codec-encoded literal, dropping quotes the codec strips', () => {
      // raw captured as a quoted string; the codec decodes it to a number and
      // re-encodes to a bare number — so the printed literal is unquoted.
      const output = printUsing('"42"');
      expect(output).toContain('using = 42');
      expect(output).not.toContain('using = "42"');
    });

    it('renders a value whose JSON form is already canonical unchanged', () => {
      const output = printUsing('42');
      expect(output).toContain('using = 42');
    });

    it('throws when the value parameter references an unregistered codec', () => {
      const block: PslExtensionBlock = {
        kind: 'fixture-policy-select',
        name: 'NumericPolicy',
        parameters: { target: refParam('Post'), using: valueParam('42') },
        span: STUB_SPAN,
      };
      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [
          {
            kind: 'namespace' as const,
            name: UNSPECIFIED_PSL_NAMESPACE_ID,
            models: [],
            enums: [],
            compositeTypes: [],
            extensionBlocks: [block],
            span: STUB_SPAN,
          },
        ],
        span: STUB_SPAN,
      };
      const emptyCodecLookup = extractCodecLookup([]);
      expect(() =>
        printPslFromAst(ast, {
          pslBlockDescriptors: assembled.pslBlockDescriptors,
          codecLookup: emptyCodecLookup,
        }),
      ).toThrow(FIXTURE_POLICY_CODEC_ID);
    });
  });

  describe('block with unregistered discriminator', () => {
    it('throws naming the unrecognised discriminator', () => {
      const block: PslExtensionBlock = {
        kind: 'no-such-discriminator',
        name: 'OrphanBlock',
        parameters: {},
        span: STUB_SPAN,
      };

      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [
          {
            kind: 'namespace' as const,
            name: UNSPECIFIED_PSL_NAMESPACE_ID,
            models: [],
            enums: [],
            compositeTypes: [],
            extensionBlocks: [block],
            span: STUB_SPAN,
          },
        ],
        span: STUB_SPAN,
      };

      expect(() =>
        printPslFromAst(ast, {
          pslBlockDescriptors: assembled.pslBlockDescriptors,
          codecLookup,
        }),
      ).toThrow('no-such-discriminator');
    });
  });

  describe('built-in print round-trip', () => {
    it('prints a model with @id field unchanged', () => {
      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [
          {
            kind: 'namespace' as const,
            name: UNSPECIFIED_PSL_NAMESPACE_ID,
            models: [
              {
                kind: 'model' as const,
                name: 'Post',
                fields: [
                  {
                    kind: 'field' as const,
                    name: 'id',
                    typeName: 'Int',
                    optional: false,
                    list: false,
                    attributes: [
                      {
                        kind: 'attribute' as const,
                        target: 'field' as const,
                        name: 'id',
                        args: [],
                        span: STUB_SPAN,
                      },
                    ],
                    span: STUB_SPAN,
                  },
                ],
                attributes: [],
                span: STUB_SPAN,
                comment: undefined,
              },
            ],
            enums: [],
            compositeTypes: [],
            extensionBlocks: [],
            span: STUB_SPAN,
          },
        ],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast);
      expect(output).toContain('model Post {');
      expect(output).toContain('id Int @id');
    });

    it('prints an enum with values unchanged', () => {
      const ast = {
        kind: 'document' as const,
        sourceId: 'test',
        namespaces: [
          {
            kind: 'namespace' as const,
            name: UNSPECIFIED_PSL_NAMESPACE_ID,
            models: [],
            enums: [
              {
                kind: 'enum' as const,
                name: 'Role',
                values: [
                  {
                    kind: 'enumValue' as const,
                    name: 'ADMIN',
                    span: STUB_SPAN,
                    attributes: [],
                    mapName: undefined,
                  },
                  {
                    kind: 'enumValue' as const,
                    name: 'USER',
                    span: STUB_SPAN,
                    attributes: [],
                    mapName: undefined,
                  },
                ],
                attributes: [],
                span: STUB_SPAN,
              },
            ],
            compositeTypes: [],
            extensionBlocks: [],
            span: STUB_SPAN,
          },
        ],
        span: STUB_SPAN,
      };

      const output = printPslFromAst(ast);
      expect(output).toContain('enum Role {');
      expect(output).toContain('ADMIN');
      expect(output).toContain('USER');
    });
  });
});
