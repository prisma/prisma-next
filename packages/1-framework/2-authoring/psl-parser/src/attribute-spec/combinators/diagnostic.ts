import type { PslDiagnostic, PslDiagnosticCode } from '@prisma-next/framework-components/psl-ast';
import { nodePslSpan } from '../../resolve';
import type { AstNode } from '../../syntax/ast-helpers';
import type { InterpretCtx } from '../types';

export const ATTRIBUTE_DIAGNOSTIC_CODE: PslDiagnosticCode = 'PSL_INVALID_ATTRIBUTE_SYNTAX';

export function leafDiagnostic(ctx: InterpretCtx, node: AstNode, message: string): PslDiagnostic {
  return {
    code: ATTRIBUTE_DIAGNOSTIC_CODE,
    message,
    sourceId: ctx.sourceId,
    span: nodePslSpan(node.syntax, ctx.sourceFile),
  };
}
