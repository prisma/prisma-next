import type { AuthoringPslBlockNamespace } from '@prisma-next/framework-components/authoring';
import type { PslDocumentAst, PslExtensionBlock } from '@prisma-next/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';

const ZERO_SPAN = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
} as const;

interface TestKeywordAst extends PslExtensionBlock {
  readonly kind: 'test-keyword';
  readonly predicate: string;
}

interface OtherKeywordAst extends PslExtensionBlock {
  readonly kind: 'other-keyword';
}

function buildPslBlocks(): AuthoringPslBlockNamespace {
  return {
    testKw: {
      kind: 'pslBlock',
      discriminator: 'test-keyword',
      parser: (ctx): TestKeywordAst => {
        let predicate = '';
        for (
          let lineIndex = ctx.bounds.startLine + 1;
          lineIndex < ctx.bounds.endLine;
          lineIndex++
        ) {
          const stripped = ctx.stripInlineComment(ctx.lines[lineIndex] ?? '').trim();
          const match = stripped.match(/^predicate\s*=\s*"((?:[^"\\]|\\.)*)"$/);
          if (match) {
            predicate = match[1] ?? '';
          }
        }
        return {
          kind: 'test-keyword',
          name: ctx.name,
          span: ctx.lineRangeSpan(ctx.bounds.startLine, ctx.bounds.endLine),
          predicate,
        };
      },
      printer: (node: TestKeywordAst, ctx) =>
        `testKw ${node.name} {\n${ctx.indent}predicate = "${ctx.escapeStringLiteral(node.predicate)}"\n}`,
    },
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
}

function makeDocAst(extensionBlocks: readonly PslExtensionBlock[]): PslDocumentAst {
  return {
    kind: 'document',
    sourceId: 't',
    namespaces: [
      {
        kind: 'namespace',
        name: UNSPECIFIED_PSL_NAMESPACE_ID,
        models: [],
        enums: [],
        compositeTypes: [],
        extensionBlocks,
        span: ZERO_SPAN,
      },
    ],
    span: ZERO_SPAN,
  };
}

describe('printPslFromAst with extension-contributed pslBlocks', () => {
  describe('given a registered discriminator and a matching AST node', () => {
    it('renders the block via the registry into the namespace section', () => {
      const ast = makeDocAst([
        {
          kind: 'test-keyword',
          name: 'Foo',
          span: ZERO_SPAN,
          predicate: 'allowed',
        } as TestKeywordAst,
      ]);

      const output = printPslFromAst(ast, { pslBlocks: buildPslBlocks() });
      expect(output).toContain('testKw Foo {');
      expect(output).toContain('predicate = "allowed"');
    });
  });

  describe('given a built-in model and an extension-contributed block in the same namespace', () => {
    it('round-trips both through parse → print → parse with the pack registries in scope', () => {
      const source = `model User {
  id Int @id
}

testKw Foo {
  predicate = "allowed"
}
`;
      const pslBlocks = buildPslBlocks();
      const parsed1 = parsePslDocument({ schema: source, sourceId: 'r1', pslBlocks });
      expect(parsed1.diagnostics).toEqual([]);
      const printed = printPslFromAst(parsed1.ast, { pslBlocks });
      const parsed2 = parsePslDocument({ schema: printed, sourceId: 'r2', pslBlocks });
      expect(parsed2.diagnostics).toEqual([]);

      const ns1 = parsed1.ast.namespaces[0];
      const ns2 = parsed2.ast.namespaces[0];
      expect(ns2?.models.map((m) => m.name)).toEqual(ns1?.models.map((m) => m.name));
      expect(ns2?.extensionBlocks.map((b) => ({ kind: b.kind, name: b.name }))).toEqual(
        ns1?.extensionBlocks.map((b) => ({ kind: b.kind, name: b.name })),
      );
    });
  });

  describe('given two distinct extension-contributed keywords in the same namespace', () => {
    it('emits both blocks in source order', () => {
      const ast = makeDocAst([
        {
          kind: 'test-keyword',
          name: 'First',
          span: ZERO_SPAN,
          predicate: 'one',
        } as TestKeywordAst,
        { kind: 'other-keyword', name: 'Second', span: ZERO_SPAN } as OtherKeywordAst,
      ]);

      const output = printPslFromAst(ast, { pslBlocks: buildPslBlocks() });
      const firstIndex = output.indexOf('testKw First');
      const secondIndex = output.indexOf('otherKw Second');
      expect(firstIndex).toBeGreaterThan(-1);
      expect(secondIndex).toBeGreaterThan(firstIndex);
    });
  });

  describe('given an AST with an extension-contributed block but no matching pslBlocks contribution', () => {
    it('throws naming the unknown discriminator', () => {
      const ast = makeDocAst([{ kind: 'unregistered-kind', name: 'Foo', span: ZERO_SPAN }]);
      expect(() => printPslFromAst(ast, { pslBlocks: buildPslBlocks() })).toThrow(
        /unregistered-kind/,
      );
    });

    it('throws when no pslBlocks argument is supplied at all', () => {
      const ast = makeDocAst([
        { kind: 'test-keyword', name: 'Foo', span: ZERO_SPAN, predicate: 'p' } as TestKeywordAst,
      ]);
      expect(() => printPslFromAst(ast)).toThrow(/test-keyword/);
    });
  });

  describe('given an extension-contributed block inside an explicit namespace', () => {
    it('emits the block indented inside the namespace wrapper', () => {
      const ast: PslDocumentAst = {
        kind: 'document',
        sourceId: 't',
        namespaces: [
          {
            kind: 'namespace',
            name: 'public',
            models: [],
            enums: [],
            compositeTypes: [],
            extensionBlocks: [
              {
                kind: 'test-keyword',
                name: 'Foo',
                span: ZERO_SPAN,
                predicate: 'p',
              } as TestKeywordAst,
            ],
            span: ZERO_SPAN,
          },
        ],
        span: ZERO_SPAN,
      };

      const output = printPslFromAst(ast, { pslBlocks: buildPslBlocks() });
      expect(output).toContain('namespace public {');
      expect(output).toContain('  testKw Foo {');
      expect(output).toContain('    predicate = "p"');
    });
  });
});
