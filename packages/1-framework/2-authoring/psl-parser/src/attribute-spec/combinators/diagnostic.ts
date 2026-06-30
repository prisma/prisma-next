import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { nodePslSpan } from '../../resolve';
import type { AstNode } from '../../syntax/ast-helpers';
import type { InterpretCtx } from '../types';

/**
 * Builds a leaf diagnostic anchored to the offending `node`, stamped with the
 * code threaded through `ctx`. Combinators emit through this helper so every
 * leaf carries the active attribute's code rather than a hard-coded generic.
 */
export function leafDiagnostic(ctx: InterpretCtx, node: AstNode, message: string): PslDiagnostic {
  return {
    code: ctx.diagnosticCode,
    message,
    sourceId: ctx.sourceId,
    span: nodePslSpan(node.syntax, ctx.sourceFile),
  };
}
