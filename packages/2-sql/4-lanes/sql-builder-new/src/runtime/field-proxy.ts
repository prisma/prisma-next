import { ColumnRef, IdentifierRef } from '@prisma-next/sql-relational-core/ast';
import type { FieldProxy } from '../expression';
import type { Scope, ScopeTable } from '../scope';
import { ExpressionImpl } from './expression-impl';

export function createFieldProxy<S extends Scope>(scope: S): FieldProxy<S> {
  return new Proxy({} as FieldProxy<S>, {
    get(_target, prop: string) {
      const topField = scope.topLevel[prop];
      if (topField) {
        return new ExpressionImpl(IdentifierRef.of(prop), topField);
      }

      const nsFields = scope.namespaces[prop];
      if (nsFields) {
        return createNamespaceProxy(prop, nsFields);
      }

      return undefined;
    },
  });
}

function createNamespaceProxy(
  namespaceName: string,
  fields: ScopeTable,
): Record<string, ExpressionImpl> {
  return new Proxy({} as Record<string, ExpressionImpl>, {
    get(_target, prop: string) {
      const field = fields[prop];
      if (field) {
        return new ExpressionImpl(ColumnRef.of(namespaceName, prop), field);
      }
      return undefined;
    },
  });
}
