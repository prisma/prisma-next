import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/**
 * Parses a bare identifier into its name, with no set or existence check. Used
 * for an argument whose identifier is validated downstream — e.g. a referential
 * action routed to its normaliser — so a parse-time check would emit a second
 * diagnostic for the same fault. Like `fieldRef` minus the resolution scope.
 */
export function identifierName(): ArgType<string> {
  return {
    kind: 'identifierName',
    label: 'identifier',
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      if (arg instanceof IdentifierAst) {
        const name = arg.name();
        if (name !== undefined) return ok(name);
      }
      return notOk([leafDiagnostic(ctx, arg, 'Expected an identifier')]);
    },
  };
}
