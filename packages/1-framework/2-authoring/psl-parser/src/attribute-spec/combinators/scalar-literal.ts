import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import {
  BooleanLiteralExprAst,
  NumberLiteralExprAst,
  StringLiteralExprAst,
} from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

// A string, number, or boolean literal reduced to its decoded value (never re-slicing text).
export function scalarLiteral(): ArgType<string | number | boolean> {
  return {
    kind: 'scalarLiteral',
    label: 'string, number, or boolean literal',
    parse: (arg, ctx): Result<string | number | boolean, readonly PslDiagnostic[]> => {
      if (
        arg instanceof StringLiteralExprAst ||
        arg instanceof NumberLiteralExprAst ||
        arg instanceof BooleanLiteralExprAst
      ) {
        const value = arg.value();
        if (value !== undefined) return ok(value);
      }
      return notOk([leafDiagnostic(ctx, arg, 'Expected a string, number, or boolean literal')]);
    },
  };
}
