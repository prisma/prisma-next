import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { NumberLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

// A general number literal — any number, including floats — reduced to its numeric value.
// Use `int()` when only integer literals are allowed.
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
