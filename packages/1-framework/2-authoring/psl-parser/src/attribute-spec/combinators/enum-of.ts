import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { NumberLiteralExprAst, StringLiteralExprAst } from '../../syntax/ast/expressions';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

type EnumMember = string | number;

/**
 * Parses an argument that is a member of a fixed set. The member may be written
 * as a string literal, a number literal, or — matching a string member — a bare
 * identifier (e.g. a referential action `Cascade`). Members may mix strings and
 * numbers, so a single `enumOf` types a homogeneous or a mixed set; the matched
 * member is returned with its literal type preserved.
 */
export function enumOf<const Values extends readonly EnumMember[]>(
  ...values: Values
): ArgType<Values[number]> {
  const members: readonly EnumMember[] = values;
  const label = members
    .map((member) => (typeof member === 'string' ? `"${member}"` : String(member)))
    .join(' | ');
  const isMember = (candidate: EnumMember): candidate is Values[number] =>
    members.includes(candidate);
  return {
    kind: 'enumOf',
    label,
    parse: (arg, ctx): Result<Values[number], readonly PslDiagnostic[]> => {
      const value =
        arg instanceof StringLiteralExprAst
          ? arg.value()
          : arg instanceof NumberLiteralExprAst
            ? arg.value()
            : arg instanceof IdentifierAst
              ? arg.name()
              : undefined;
      if (value !== undefined && isMember(value)) return ok(value);
      return notOk([leafDiagnostic(ctx, arg, `Expected one of: ${label}`)]);
    },
  };
}
