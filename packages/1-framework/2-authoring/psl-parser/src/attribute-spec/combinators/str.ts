import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { StringLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/** Parses a quoted string-literal argument into its decoded value. */
export function str(): ArgType<string> {
  return {
    kind: 'str',
    label: 'string',
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      if (arg instanceof StringLiteralExprAst) {
        const value = arg.value();
        if (value !== undefined) return ok(value);
      }
      return notOk([leafDiagnostic(ctx, arg, 'Expected a string literal')]);
    },
  };
}
