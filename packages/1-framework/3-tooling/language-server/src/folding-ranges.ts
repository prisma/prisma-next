import type {
  DocumentAst,
  NamespaceDeclarationAst,
  SourceFile,
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
    const lbrace = declaration.lbrace();
    const rbrace = declaration.rbrace();

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
          const nestedLbrace = nested.lbrace();
          const nestedRbrace = nested.rbrace();

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

function isNamespaceDeclaration(declaration: object): declaration is NamespaceDeclarationAst {
  if (!('syntax' in declaration)) return false;
  const syntax = declaration.syntax;
  if (typeof syntax !== 'object' || syntax === null) return false;
  if (!('kind' in syntax)) return false;
  return syntax.kind === 'Namespace';
}
