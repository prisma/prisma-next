import type {
  DocumentAst,
  NamespaceDeclarationAst,
  SourceFile,
  SyntaxToken,
} from '@prisma-next/psl-parser/syntax';
import { type FoldingRange, FoldingRangeKind } from 'vscode-languageserver';

/**
 * Computes folding ranges for block declarations in a PSL document.
 *
 * Block types that produce folding ranges:
 * - model (e.g., `model User { ... }`)
 * - composite type (e.g., `type Address { ... }`)
 * - namespace (e.g., `namespace billing { ... }`)
 * - generic blocks (generator, datasource, extension blocks)
 * - types block (e.g., `types { ... }`)
 *
 * The range spans from the line containing `{` to the line containing `}`.
 */
export function computeFoldingRanges(
  document: DocumentAst,
  sourceFile: SourceFile,
): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  collectFoldingRanges(document, sourceFile, ranges);
  return ranges;
}

function collectFoldingRanges(
  document: DocumentAst,
  sourceFile: SourceFile,
  ranges: FoldingRange[],
): void {
  for (const declaration of document.declarations()) {
    const lbrace = declaration.lbrace() as SyntaxToken | undefined;
    const rbrace = declaration.rbrace() as SyntaxToken | undefined;

    if (lbrace !== undefined && rbrace !== undefined) {
      const startLine = sourceFile.positionAt(lbrace.offset).line;
      const endLine = sourceFile.positionAt(rbrace.offset).line;

      ranges.push({
        startLine,
        endLine,
        kind: FoldingRangeKind.Region,
      });

      // Recurse into namespace declarations
      if (isNamespaceDeclaration(declaration)) {
        for (const nested of declaration.declarations()) {
          const nestedLbrace = nested.lbrace() as SyntaxToken | undefined;
          const nestedRbrace = nested.rbrace() as SyntaxToken | undefined;

          if (nestedLbrace !== undefined && nestedRbrace !== undefined) {
            const nestedStartLine = sourceFile.positionAt(nestedLbrace.offset).line;
            const nestedEndLine = sourceFile.positionAt(nestedRbrace.offset).line;

            ranges.push({
              startLine: nestedStartLine,
              endLine: nestedEndLine,
              kind: FoldingRangeKind.Region,
            });
          }
        }
      }
    }
  }
}

function isNamespaceDeclaration(declaration: unknown): declaration is NamespaceDeclarationAst {
  return (
    typeof declaration === 'object' &&
    declaration !== null &&
    'syntax' in declaration &&
    typeof (declaration as { syntax: { kind: string } }).syntax?.kind === 'string' &&
    (declaration as { syntax: { kind: string } }).syntax.kind === 'Namespace'
  );
}
