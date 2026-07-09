import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

// A bare identifier (e.g. an enum member name) → its text. No validation; the
// caller decides what the identifier must resolve to.
export function bareIdentifier(): ArgType<string> {
  return {
    kind: 'bareIdentifier',
    label: 'an identifier',
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      if (!(arg instanceof IdentifierAst)) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected an identifier')]);
      }
      const name = arg.name();
      if (name === undefined) return notOk([leafDiagnostic(ctx, arg, 'Expected an identifier')]);
      return ok(name);
    },
  };
}
