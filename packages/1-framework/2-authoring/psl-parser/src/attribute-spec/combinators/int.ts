import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { NumberLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

export function int(): ArgType<number> {
  return {
    kind: 'int',
    label: 'integer',
    parse: (arg, ctx): Result<number, readonly PslDiagnostic[]> => {
      if (arg instanceof NumberLiteralExprAst) {
        const value = arg.value();
        if (value !== undefined && Number.isInteger(value)) return ok(value);
      }
      return notOk([leafDiagnostic(ctx, arg, 'Expected an integer literal')]);
    },
  };
}
