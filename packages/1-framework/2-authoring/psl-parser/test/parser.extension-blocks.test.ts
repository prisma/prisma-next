import type { AuthoringPslBlockNamespace } from '@prisma-next/framework-components/authoring';
import type {
  PslExtensionBlock,
  PslExtensionBlockParserContext,
} from '@prisma-next/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { parsePslDocument } from '../src/parser';

interface TestKeywordAst extends PslExtensionBlock {
  readonly kind: 'test-keyword';
  readonly extra: string;
}

interface OtherKeywordAst extends PslExtensionBlock {
  readonly kind: 'other-keyword';
}

function makeTestKwBlocks(): AuthoringPslBlockNamespace {
  return {
    testKw: {
      kind: 'pslBlock',
      discriminator: 'test-keyword',
      parser: (ctx: PslExtensionBlockParserContext): TestKeywordAst => {
        let extra = '';
        for (
          let lineIndex = ctx.bounds.startLine + 1;
          lineIndex < ctx.bounds.endLine;
          lineIndex++
        ) {
          const raw = ctx.lines[lineIndex] ?? '';
          const stripped = ctx.stripInlineComment(raw).trim();
          const match = stripped.match(/^extra\s*=\s*"((?:[^"\\]|\\.)*)"$/);
          if (match) {
            extra = match[1] ?? '';
          }
        }
        return {
          kind: 'test-keyword',
          name: ctx.name,
          span: ctx.lineRangeSpan(ctx.bounds.startLine, ctx.bounds.endLine),
          extra,
        };
      },
      printer: (node: TestKeywordAst, ctx) =>
        `testKw ${node.name} {\n${ctx.indent}extra = "${ctx.escapeStringLiteral(node.extra)}"\n}`,
    },
  };
}

describe('parsePslDocument with extension-contributed pslBlocks', () => {
  describe('given a registered keyword', () => {
    it('routes the block to the contribution and lands the AST node in extensionBlocks', () => {
      const result = parsePslDocument({
        schema: 'testKw Foo {\n  extra = "hello"\n}\n',
        sourceId: 'schema.prisma',
        pslBlocks: makeTestKwBlocks(),
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.ok).toBe(true);
      const namespace = result.ast.namespaces[0];
      expect(namespace).toBeDefined();
      expect(namespace?.extensionBlocks).toEqual([
        expect.objectContaining({
          kind: 'test-keyword',
          name: 'Foo',
          extra: 'hello',
        }),
      ]);
    });

    it('lets the contribution emit diagnostics through the SPI handle', () => {
      const blocks: AuthoringPslBlockNamespace = {
        diagKw: {
          kind: 'pslBlock',
          discriminator: 'diag-keyword',
          parser: (ctx) => {
            ctx.pushDiagnostic({
              code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
              message: `extension-contributed parser saw block "${ctx.name}"`,
              span: ctx.trimmedLineSpan(ctx.bounds.startLine),
            });
            return {
              kind: 'diag-keyword',
              name: ctx.name,
              span: ctx.lineRangeSpan(ctx.bounds.startLine, ctx.bounds.endLine),
            };
          },
          printer: (node) => `diagKw ${node.name} {\n}`,
        },
      };
      const result = parsePslDocument({
        schema: 'diagKw Foo {\n}\n',
        sourceId: 'schema.prisma',
        pslBlocks: blocks,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toMatchObject({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        sourceId: 'schema.prisma',
        message: 'extension-contributed parser saw block "Foo"',
      });
    });
  });

  describe('given an unrecognised top-level keyword', () => {
    it('emits PSL_UNSUPPORTED_TOP_LEVEL_BLOCK with the keyword and span', () => {
      const result = parsePslDocument({
        schema: 'notARegisteredKeyword Foo {\n}\n',
        sourceId: 'schema.prisma',
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toMatchObject({
        code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        message: expect.stringContaining('notARegisteredKeyword'),
      });
      expect(result.diagnostics[0]?.span.start.line).toBe(1);
    });
  });

  describe('given two registered keywords in the same namespace', () => {
    it('preserves source order in extensionBlocks', () => {
      const blocks: AuthoringPslBlockNamespace = {
        ...makeTestKwBlocks(),
        otherKw: {
          kind: 'pslBlock',
          discriminator: 'other-keyword',
          parser: (ctx): OtherKeywordAst => ({
            kind: 'other-keyword',
            name: ctx.name,
            span: ctx.lineRangeSpan(ctx.bounds.startLine, ctx.bounds.endLine),
          }),
          printer: (node: OtherKeywordAst) => `otherKw ${node.name} {\n}`,
        },
      };

      const result = parsePslDocument({
        schema: 'testKw First {\n  extra = "x"\n}\notherKw Second {\n}\n',
        sourceId: 'schema.prisma',
        pslBlocks: blocks,
      });

      expect(result.diagnostics).toEqual([]);
      const extensionBlocks = result.ast.namespaces[0]?.extensionBlocks ?? [];
      expect(extensionBlocks.map((block) => ({ kind: block.kind, name: block.name }))).toEqual([
        { kind: 'test-keyword', name: 'First' },
        { kind: 'other-keyword', name: 'Second' },
      ]);
    });
  });

  describe('given a namespace mixing built-in and extension-contributed blocks', () => {
    it('routes each kind into its own slot and preserves names', () => {
      const result = parsePslDocument({
        schema:
          'model User {\n  id Int @id\n}\ntestKw Foo {\n  extra = "x"\n}\nmodel Post {\n  id Int @id\n}\n',
        sourceId: 'schema.prisma',
        pslBlocks: makeTestKwBlocks(),
      });

      expect(result.diagnostics).toEqual([]);
      const namespace = result.ast.namespaces[0];
      expect(namespace?.models.map((model) => model.name)).toEqual(['User', 'Post']);
      expect(namespace?.extensionBlocks.map((block) => block.name)).toEqual(['Foo']);
      const fooBlock = namespace?.extensionBlocks[0];
      expect(fooBlock).toMatchObject({
        kind: 'test-keyword',
        name: 'Foo',
        extra: 'x',
      });
    });
  });

  describe('given extension-contributed blocks inside an explicit namespace', () => {
    it('routes blocks into the enclosing namespace bucket', () => {
      const result = parsePslDocument({
        schema: 'namespace public {\n  testKw Foo {\n    extra = "y"\n  }\n}\n',
        sourceId: 'schema.prisma',
        pslBlocks: makeTestKwBlocks(),
      });

      expect(result.diagnostics).toEqual([]);
      const publicNamespace = result.ast.namespaces.find((ns) => ns.name === 'public');
      expect(publicNamespace?.extensionBlocks).toEqual([
        expect.objectContaining({ kind: 'test-keyword', name: 'Foo', extra: 'y' }),
      ]);
    });
  });

  describe('contributed-parser failure isolation', () => {
    it('converts a throwing contributed parser into a diagnostic and continues parsing', () => {
      const blocks: AuthoringPslBlockNamespace = {
        throwingKw: {
          kind: 'pslBlock',
          discriminator: 'throwing-keyword',
          parser: (_ctx): PslExtensionBlock => {
            throw new Error('parser explosion');
          },
          printer: (node) => `throwingKw ${node.name} {\n}`,
        },
        ...makeTestKwBlocks(),
      };

      const result = parsePslDocument({
        schema: 'throwingKw Bad {\n}\ntestKw Good {\n  extra = "ok"\n}\n',
        sourceId: 'schema.prisma',
        pslBlocks: blocks,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        code: 'PSL_EXTENSION_BLOCK_PARSE_FAILED',
        sourceId: 'schema.prisma',
        message: expect.stringContaining('parser explosion'),
      });
      const namespace = result.ast.namespaces[0];
      expect(namespace?.extensionBlocks).toHaveLength(1);
      expect(namespace?.extensionBlocks[0]).toMatchObject({ kind: 'test-keyword', name: 'Good' });
    });

    it('converts an undefined-returning contributed parser into a diagnostic', () => {
      const blocks: AuthoringPslBlockNamespace = {
        undefinedKw: {
          kind: 'pslBlock',
          discriminator: 'undefined-keyword',
          // Cast needed to simulate a misbehaving JS contributor that ignores the return type
          parser: (_ctx): PslExtensionBlock => undefined as unknown as PslExtensionBlock,
          printer: (node) => `undefinedKw ${node.name} {\n}`,
        },
      };

      const result = parsePslDocument({
        schema: 'undefinedKw Oops {\n}\n',
        sourceId: 'schema.prisma',
        pslBlocks: blocks,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toMatchObject({
        code: 'PSL_EXTENSION_BLOCK_PARSE_FAILED',
        sourceId: 'schema.prisma',
        message: expect.stringContaining('returned no node'),
      });
      // The failed block produces no node, so the unspecified namespace stays
      // empty and is dropped from the output — no namespace appears.
      expect(result.ast.namespaces).toHaveLength(0);
    });

    it('emits a diagnostic at parse time when node.kind does not match descriptor.discriminator', () => {
      const blocks: AuthoringPslBlockNamespace = {
        mismatchKw: {
          kind: 'pslBlock',
          discriminator: 'correct-discriminator',
          // Cast needed to simulate a contributed parser with a discriminator typo
          parser: (ctx): PslExtensionBlock => ({
            kind: 'wrong-kind' as 'correct-discriminator',
            name: ctx.name,
            span: ctx.lineRangeSpan(ctx.bounds.startLine, ctx.bounds.endLine),
          }),
          printer: (node) => `mismatchKw ${node.name} {\n}`,
        },
      };

      const result = parsePslDocument({
        schema: 'mismatchKw Typo {\n}\n',
        sourceId: 'schema.prisma',
        pslBlocks: blocks,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toMatchObject({
        code: 'PSL_EXTENSION_BLOCK_PARSE_FAILED',
        sourceId: 'schema.prisma',
        message: expect.stringContaining('correct-discriminator'),
      });
      expect(result.diagnostics[0]?.message).toContain('wrong-kind');
      // The mismatched node is rejected, so the unspecified namespace stays
      // empty and is dropped from the output — no namespace appears.
      expect(result.ast.namespaces).toHaveLength(0);
    });
  });
});
