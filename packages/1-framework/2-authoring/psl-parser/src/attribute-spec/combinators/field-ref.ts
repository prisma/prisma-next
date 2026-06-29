import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/**
 * The entity a field name resolves against: the declaring model (`'self'`) or a
 * relation's target model (`'referenced'`). Carried for the language server;
 * the value parsed at runtime is just the name.
 */
export type FieldRefScope = 'self' | 'referenced';

/** A field-name combinator tagged with the scope its name resolves against. */
export interface FieldRefArgType extends ArgType<string> {
  readonly scope: FieldRefScope;
}

/**
 * Parses a bare identifier into the field name. Existence is deliberately not
 * checked here: the downstream interpreter validates the field against the
 * scoped entity, so a parse-time check would emit a second diagnostic for the
 * same fault.
 */
export function fieldRef(scope: FieldRefScope): FieldRefArgType {
  return {
    kind: 'fieldRef',
    label: 'field name',
    scope,
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      if (arg instanceof IdentifierAst) {
        const name = arg.name();
        if (name !== undefined) return ok(name);
      }
      return notOk([leafDiagnostic(ctx, arg, 'Expected a field name')]);
    },
  };
}
