import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { nodePslSpan } from '../../resolve';
import type { AstNode } from '../../syntax/ast-helpers';
import type { InterpretCtx } from '../types';

export function leafDiagnostic(ctx: InterpretCtx, node: AstNode, message: string): PslDiagnostic {
  return {
    // every leaf routes through here, so none hard-codes a code — use the attribute's, set on ctx by interpretAttribute.
    code: ctx.diagnosticCode,
    message,
    sourceId: ctx.sourceId,
    span: nodePslSpan(node.syntax, ctx.sourceFile),
  };
}
