import type { PslDocumentAst } from '@prisma-next/framework-components/psl-ast';
import { astDocumentToPrintDocument } from './ast-to-print-document';
import { serializePrintDocument } from './serialize-print-document';

export function printPslFromAst(ast: PslDocumentAst): string {
  const doc = astDocumentToPrintDocument(ast);
  return serializePrintDocument(doc);
}
