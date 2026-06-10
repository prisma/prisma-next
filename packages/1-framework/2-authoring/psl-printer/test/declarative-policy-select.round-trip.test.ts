/**
 * Round-trip test for the declarative extension-block mechanism.
 *
 * Exercises the full pipeline for a declarative extension contribution:
 *
 *   text → parse → validate → lower via entityTypes factory → PolicySelectIr
 *        → serialize → hydrate → IR → print → re-parse → equivalent AST node
 *
 * The fixture (`./fixtures/declarative-policy-select-extension.ts`) contributes
 * NO parser or printer code. All parsing, validation, and printing is
 * framework-owned. The print legs (IR → PSL text → re-parse) confirm the
 * generic printer closes the loop.
 *
 * A stub codec for `fixture-policy/text@1` is registered for the duration of
 * these tests so the validator can accept double-quoted `using` literals and
 * the printer can round-trip them via the codec's JSON encode/decode.
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
import {
  namespacePslExtensionBlocks,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@prisma-next/framework-components/psl-ast';
import { parsePslDocument } from '@prisma-next/psl-parser';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import {
  declarativePolicySelectContributions,
  FIXTURE_POLICY_CODEC_ID,
  hydratePolicySelectIrFromJson,
  POLICY_SELECT_DISCRIMINATOR,
  PolicySelectIr,
} from './fixtures/declarative-policy-select-extension';

// ---------------------------------------------------------------------------
// Stub codec — accepts any double-quoted string literal for the `using` param
// ---------------------------------------------------------------------------

class FixturePolicyTextCodec extends CodecImpl<
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

class FixturePolicyTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = FIXTURE_POLICY_CODEC_ID as typeof FIXTURE_POLICY_CODEC_ID;
  override readonly traits = ['textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => FixturePolicyTextCodec {
    return () => new FixturePolicyTextCodec(this);
  }
}

const fixtureCodecDescriptor = new FixturePolicyTextDescriptor();

const codecLookup = extractCodecLookup([
  {
    id: 'fixture-policy-ext',
    types: { codecTypes: { codecDescriptors: [fixtureCodecDescriptor] } },
  },
]);

const assembled = assembleAuthoringContributions([
  { authoring: declarativePolicySelectContributions },
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFactory() {
  const factoryEntry = assembled.entityTypes['policy_select'];
  if (factoryEntry === undefined || !('output' in factoryEntry)) {
    throw new Error('expected entityTypes.policy_select descriptor');
  }
  const output = factoryEntry.output;
  if (!('factory' in output) || typeof output.factory !== 'function') {
    throw new Error('expected entityTypes.policy_select.output.factory function');
  }
  return output.factory as (block: unknown, ctx: unknown) => PolicySelectIr;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('declarative policy_select round-trip (parse → validate → lower → IR)', () => {
  describe('given a PSL document with a policy_select block and a matching model', () => {
    const source = `model Post {
  id   Int    @id
  body String
}

policy_select ProfilesSelect {
  target = Post
  using  = "auth.uid() = author_id"
}
`;

    it('parses the block into a uniform PslExtensionBlock with the correct discriminator', () => {
      const parsed = parsePslDocument({
        schema: source,
        sourceId: 'r1',
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(parsed.diagnostics).toEqual([]);
      const ns = parsed.ast.namespaces.find((n) => n.name === UNSPECIFIED_PSL_NAMESPACE_ID);
      const nsExtBlocks = namespacePslExtensionBlocks(ns!);
      expect(nsExtBlocks).toHaveLength(1);
      const block = nsExtBlocks[0];
      expect(block).toMatchObject({
        kind: POLICY_SELECT_DISCRIMINATOR,
        name: 'ProfilesSelect',
      });
    });

    it('validates the block and surfaces no diagnostics for a well-formed block', () => {
      const parsed = parsePslDocument({
        schema: source,
        sourceId: 'r1',
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(parsed.ok).toBe(true);
      expect(parsed.diagnostics).toEqual([]);
    });

    it('lowers the parsed block to a PolicySelectIr via the entityTypes factory', () => {
      const parsed = parsePslDocument({
        schema: source,
        sourceId: 'r1',
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(parsed.diagnostics).toEqual([]);
      const ns = parsed.ast.namespaces.find((n) => n.name === UNSPECIFIED_PSL_NAMESPACE_ID);
      const block = namespacePslExtensionBlocks(ns!)[0];
      if (!block) throw new Error('expected one extension block');

      const factory = getFactory();
      const ir = factory(block, { family: 'fixture', target: 'fixture' });

      expect(ir).toBeInstanceOf(PolicySelectIr);
      expect(Object.isFrozen(ir)).toBe(true);
      expect(ir).toMatchObject({
        kind: POLICY_SELECT_DISCRIMINATOR,
        name: 'ProfilesSelect',
        target: 'Post',
        using: 'auth.uid() = author_id',
      });
      expect(ir.as).toBeUndefined();
    });

    it('serializes and re-hydrates the IR instance without losing fields', () => {
      const parsed = parsePslDocument({
        schema: source,
        sourceId: 'r1',
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });
      const ns = parsed.ast.namespaces.find((n) => n.name === UNSPECIFIED_PSL_NAMESPACE_ID);
      const block = namespacePslExtensionBlocks(ns!)[0];
      if (!block) throw new Error('expected one extension block');

      const ir = getFactory()(block, { family: 'fixture', target: 'fixture' });
      const serialized = JSON.stringify(ir);
      const hydrated = hydratePolicySelectIrFromJson(JSON.parse(serialized));

      expect(hydrated).toBeInstanceOf(PolicySelectIr);
      expect(Object.isFrozen(hydrated)).toBe(true);
      expect(JSON.stringify(hydrated)).toBe(serialized);
      expect({ ...hydrated }).toEqual({ ...ir });
    });
  });

  describe('given a block with the optional `as` parameter', () => {
    const source = `model Post {
  id Int @id
}

policy_select AdminRead {
  target = Post
  as     = permissive
  using  = "role = \\"admin\\""
}
`;

    it('lowers the `as` option into the IR instance', () => {
      const parsed = parsePslDocument({
        schema: source,
        sourceId: 'r1',
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(parsed.diagnostics).toEqual([]);
      const ns = parsed.ast.namespaces.find((n) => n.name === UNSPECIFIED_PSL_NAMESPACE_ID);
      const block = namespacePslExtensionBlocks(ns!)[0];
      if (!block) throw new Error('expected one extension block');

      const ir = getFactory()(block, { family: 'fixture', target: 'fixture' });
      expect(ir).toBeInstanceOf(PolicySelectIr);
      expect(ir.as).toBe('permissive');
      expect(ir.name).toBe('AdminRead');
      expect(ir.target).toBe('Post');
    });
  });

  describe('given a block with a missing required `using` parameter', () => {
    const source = `model Post {
  id Int @id
}

policy_select BadBlock {
  target = Post
}
`;

    it('surfaces a PSL_EXTENSION_MISSING_REQUIRED_PARAMETER diagnostic', () => {
      const parsed = parsePslDocument({
        schema: source,
        sourceId: 'r1',
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(parsed.ok).toBe(false);
      expect(parsed.diagnostics).toMatchObject([
        {
          code: 'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER',
          message: expect.stringContaining('using'),
        },
      ]);
    });
  });

  describe('given a block with an unresolvable target ref', () => {
    const source = `policy_select OrphanPolicy {
  target = NonExistentModel
  using  = "true"
}
`;

    it('surfaces a PSL_EXTENSION_UNRESOLVED_REF diagnostic', () => {
      const parsed = parsePslDocument({
        schema: source,
        sourceId: 'r1',
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(parsed.ok).toBe(false);
      expect(parsed.diagnostics).toMatchObject([
        {
          code: 'PSL_EXTENSION_UNRESOLVED_REF',
          message: expect.stringContaining('NonExistentModel'),
        },
      ]);
    });
  });

  describe('given a block without a codecLookup in the parse call', () => {
    it('still parses and produces the AST node, but codec validation rejects the value parameter', () => {
      const source = `model Post {
  id Int @id
}

policy_select NakedParse {
  target = Post
  using  = "auth.uid() = id"
}
`;
      // Without codecLookup the parser falls back to emptyCodecLookup, which
      // rejects every codec id — so a value parameter always fails validation.
      const parsed = parsePslDocument({
        schema: source,
        sourceId: 'r1',
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        // codecLookup intentionally omitted
      });

      // The AST is still built (the parse pass succeeds).
      const ns = parsed.ast.namespaces.find((n) => n.name === UNSPECIFIED_PSL_NAMESPACE_ID);
      expect(namespacePslExtensionBlocks(ns!)).toHaveLength(1);

      // But validation flags the value parameter as rejected.
      expect(parsed.ok).toBe(false);
      expect(parsed.diagnostics[0]).toMatchObject({
        code: 'PSL_EXTENSION_INVALID_VALUE',
      });
    });
  });

  describe('full round-trip: parse → validate → lower → IR → serialize → hydrate → IR → print → re-parse', () => {
    const source = `model Post {
  id   Int    @id
  body String
}

policy_select ProfilesSelect {
  target = Post
  using  = "auth.uid() = author_id"
}
`;

    it('prints the block back to PSL text that contains the keyword and all parameters', () => {
      const parsed = parsePslDocument({
        schema: source,
        sourceId: 'rt1',
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(parsed.diagnostics).toEqual([]);
      const printed = printPslFromAst(parsed.ast, {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(printed).toContain('policy_select ProfilesSelect {');
      expect(printed).toContain('target = Post');
      expect(printed).toContain('using = "auth.uid() = author_id"');
    });

    it('re-parses the printed PSL and produces an AST-structurally equivalent extension block', () => {
      const firstParsed = parsePslDocument({
        schema: source,
        sourceId: 'rt2',
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(firstParsed.diagnostics).toEqual([]);

      const printed = printPslFromAst(firstParsed.ast, {
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      const reParsed = parsePslDocument({
        schema: printed,
        sourceId: 'rt2-reparse',
        pslBlockDescriptors: assembled.pslBlockDescriptors,
        codecLookup,
      });

      expect(reParsed.diagnostics).toEqual([]);

      const originalNs = firstParsed.ast.namespaces.find(
        (n) => n.name === UNSPECIFIED_PSL_NAMESPACE_ID,
      );
      const reParsedNs = reParsed.ast.namespaces.find(
        (n) => n.name === UNSPECIFIED_PSL_NAMESPACE_ID,
      );
      const originalExtBlocks = namespacePslExtensionBlocks(originalNs!);
      const reParsedExtBlocks = namespacePslExtensionBlocks(reParsedNs!);
      expect(originalExtBlocks).toHaveLength(1);
      expect(reParsedExtBlocks).toHaveLength(1);

      const original = originalExtBlocks[0];
      const reParsedBlock = reParsedExtBlocks[0];
      if (!original || !reParsedBlock) throw new Error('expected one extension block each');

      // Semantic equivalence: lower both blocks to their IR and compare. The IR
      // is the contract-bound artifact, so identical IR after print → re-parse is
      // the round-trip guarantee that matters — the equivalent of the two
      // documents hashing the same, and stronger than matching a few AST fields.
      const lower = getFactory();
      const originalIr = lower(original, { family: 'fixture', target: 'fixture' });
      const reParsedIr = lower(reParsedBlock, { family: 'fixture', target: 'fixture' });
      expect(JSON.stringify(reParsedIr)).toBe(JSON.stringify(originalIr));
    });
  });
});
