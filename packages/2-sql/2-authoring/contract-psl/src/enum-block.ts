import type {
  PslExtensionBlock,
  PslExtensionBlockAttribute,
  PslExtensionBlockParamValue,
  PslSpan,
} from '@prisma-next/psl-parser';
import type {
  GenericBlockDeclarationAst,
  Range,
  SourceFile,
  SyntaxNode,
} from '@prisma-next/psl-parser/syntax';
import { printSyntax } from '@prisma-next/psl-parser/syntax';
import { readAttribute } from './cst-read';

/**
 * Reconstruct the legacy `PslExtensionBlock` shape the SQL enum factory consumes
 * from a CST `GenericBlockDeclarationAst` (the symbol table's `BlockSymbol.node`).
 *
 * The symbol table defers block-parameter parsing, so this seam reproduces what
 * the legacy `parsePslDocument` extension-block parser produced for the factory:
 * `@@type(...)` block attributes (via the dispatch-1 attribute reader) and the
 * member `parameters` map (bare members → `{ kind: 'bare' }`, `key = value`
 * members → `{ kind: 'value', raw }` where `raw` is the verbatim source value,
 * matching the legacy descriptor-free path for a variadic block). First
 * occurrence of a duplicate member name wins, as the legacy parser did.
 */
export function reconstructExtensionBlock(
  node: GenericBlockDeclarationAst,
  sourceFile: SourceFile,
): PslExtensionBlock {
  const blockAttributes: PslExtensionBlockAttribute[] = [];
  for (const attribute of node.attributes()) {
    const read = readAttribute(attribute, sourceFile);
    blockAttributes.push({
      name: read.name,
      args: read.args
        .filter((arg) => arg.kind === 'positional')
        .map((arg) => ({
          kind: 'positional' as const,
          value: arg.value,
          span: toPslSpan(arg.range, sourceFile),
        })),
      span: toPslSpan(read.range, sourceFile),
    });
  }

  const parameters: Record<string, PslExtensionBlockParamValue> = {};
  for (const entry of node.entries()) {
    const key = entry.key()?.name();
    if (key === undefined || Object.hasOwn(parameters, key)) continue;
    const span = nodeSpan(entry.syntax, sourceFile);
    const value = entry.value();
    parameters[key] =
      value === undefined
        ? { kind: 'bare', span }
        : { kind: 'value', raw: printSyntax(value.syntax).trim(), span };
  }

  return {
    kind: 'enum',
    name: node.name()?.name() ?? '',
    parameters,
    blockAttributes,
    span: nodeSpan(node.syntax, sourceFile),
  };
}

function nodeSpan(node: SyntaxNode, sourceFile: SourceFile): PslSpan {
  const start = node.offset;
  const end = start + node.green.textLength;
  return {
    start: toPslPosition(start, sourceFile),
    end: toPslPosition(end, sourceFile),
  };
}

function toPslSpan(range: Range, sourceFile: SourceFile): PslSpan {
  return {
    start: toPslPosition(sourceFile.offsetAt(range.start), sourceFile),
    end: toPslPosition(sourceFile.offsetAt(range.end), sourceFile),
  };
}

function toPslPosition(offset: number, sourceFile: SourceFile): PslSpan['start'] {
  const position = sourceFile.positionAt(offset);
  return { offset, line: position.line + 1, column: position.character + 1 };
}
