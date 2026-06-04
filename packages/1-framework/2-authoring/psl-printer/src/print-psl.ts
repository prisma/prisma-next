import type { AuthoringPslPrinterNamespace } from '@prisma-next/framework-components/authoring';
import type { PslDocumentAst } from '@prisma-next/framework-components/psl-ast';
import { astDocumentToPrintDocument } from './ast-to-print-document';
import { serializePrintDocument } from './serialize-print-document';

export type PslPrintersNamespace = AuthoringPslPrinterNamespace;

export interface PrintPslOptions {
  /**
   * Pack-contributed printer contributions, indexed by user-facing path.
   * Typically an `AssembledAuthoringContributions.pslPrinters` namespace
   * produced by `assembleAuthoringContributions`. The printer dispatch
   * indexes into this namespace by each pack-contributed AST node's
   * `kind` discriminator.
   *
   * When absent, an AST that contains pack-contributed blocks throws —
   * silently dropping those blocks would lose user-authored content
   * without diagnostic. ASTs that contain only framework-parsed blocks
   * print without any `pslPrinters` argument, which is what existing
   * call sites do today.
   */
  readonly pslPrinters?: PslPrintersNamespace;
}

export function printPslFromAst(ast: PslDocumentAst, options: PrintPslOptions = {}): string {
  const doc = astDocumentToPrintDocument(ast);
  return serializePrintDocument(
    doc,
    options.pslPrinters !== undefined ? { pslPrinters: options.pslPrinters } : {},
  );
}
