import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { BooleanLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

export function bool(): ArgType<boolean> {
  return {
    kind: 'bool',
    label: 'boolean',
    parse: (arg, ctx): Result<boolean, readonly PslDiagnostic[]> => {
      if (arg instanceof BooleanLiteralExprAst) {
        const value = arg.value();
        if (value !== undefined) return ok(value);
      }
      return notOk([leafDiagnostic(ctx, arg, 'Expected a boolean literal')]);
    },
  };
}
