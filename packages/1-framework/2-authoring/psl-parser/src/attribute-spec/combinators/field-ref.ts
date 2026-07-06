import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/** Carried for the language server; the value parsed at runtime is just the name. */
export type FieldRefScope = 'self' | 'referenced';

export interface FieldRefArgType extends ArgType<string> {
  readonly scope: FieldRefScope;
}

/**
 * When the referenced model is out of scope (e.g. a cross-space target the
 * parser cannot see), existence cannot be checked, so the name is carried
 * through unchecked and validated where the target is known.
 */
export function fieldRef(scope: FieldRefScope): FieldRefArgType {
  return {
    kind: 'fieldRef',
    label: 'field name',
    scope,
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      if (!(arg instanceof IdentifierAst)) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a field name')]);
      }
      const name = arg.name();
      if (name === undefined) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a field name')]);
      }
      const model = scope === 'self' ? ctx.selfModel : ctx.resolveReferencedModel();
      if (model !== undefined && !Object.hasOwn(model.fields, name)) {
        return notOk([
          leafDiagnostic(ctx, arg, `Field "${name}" does not exist on model "${model.name}"`),
        ]);
      }
      return ok(name);
    },
  };
}
