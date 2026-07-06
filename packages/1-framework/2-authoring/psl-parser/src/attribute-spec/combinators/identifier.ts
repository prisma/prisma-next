import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/**
 * Pinned-only: there is no open form, so several `identifier`s composed under
 * `oneOf` infer the precise union of names.
 */
export function identifier<const N extends string>(name: N): ArgType<N> {
  return {
    kind: 'identifier',
    label: name,
    parse: (arg, ctx): Result<N, readonly PslDiagnostic[]> => {
      if (arg instanceof IdentifierAst && arg.name() === name) return ok(name);
      return notOk([leafDiagnostic(ctx, arg, `Expected ${name}`)]);
    },
  };
}
