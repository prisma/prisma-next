import type { AuthoringPslBlockNamespace } from '@prisma-next/framework-components/authoring';
import type { PslDocumentAst } from '@prisma-next/framework-components/psl-ast';
import { astDocumentToPrintDocument } from './ast-to-print-document';
import { serializePrintDocument } from './serialize-print-document';

export type PslBlocksNamespace = AuthoringPslBlockNamespace;

export interface PrintPslOptions {
  /**
   * Pack-contributed PSL block contributions, indexed by user-facing
   * path. Typically an `AssembledAuthoringContributions.pslBlocks`
   * namespace produced by `assembleAuthoringContributions`. The printer
   * dispatch indexes into this namespace by each pack-contributed AST
   * node's `kind` discriminator and renders via the descriptor's
   * `printer` (parser and printer live on the same descriptor).
   *
   * When absent, an AST that contains pack-contributed blocks throws —
   * silently dropping those blocks would lose user-authored content
   * without diagnostic. ASTs that contain only framework-parsed blocks
   * print without any `pslBlocks` argument, which is what existing call
   * sites do today.
   */
  readonly pslBlocks?: PslBlocksNamespace;
}

export function printPslFromAst(ast: PslDocumentAst, options: PrintPslOptions = {}): string {
  const doc = astDocumentToPrintDocument(ast);
  return serializePrintDocument(
    doc,
    options.pslBlocks !== undefined ? { pslBlocks: options.pslBlocks } : {},
  );
}
