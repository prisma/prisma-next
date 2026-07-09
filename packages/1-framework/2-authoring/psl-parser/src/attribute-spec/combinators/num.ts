import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { NumberLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

// Any number literal (integers and floats alike) reduced to its numeric value. For an
// integer-only constraint use `int()`.
export function num(): ArgType<number> {
  return {
    kind: 'num',
    label: 'number',
    parse: (arg, ctx): Result<number, readonly PslDiagnostic[]> => {
      if (arg instanceof NumberLiteralExprAst) {
        const value = arg.value();
        if (value !== undefined) return ok(value);
      }
      return notOk([leafDiagnostic(ctx, arg, 'Expected a number literal')]);
    },
  };
}
