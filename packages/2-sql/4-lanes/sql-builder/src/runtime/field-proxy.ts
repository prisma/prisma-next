import { ColumnRef, IdentifierRef } from '@prisma-next/sql-relational-core/ast';
import type { FieldProxy } from '../expression';
import type { Scope, ScopeTable } from '../scope';
import { ExpressionImpl } from './expression-impl';

/**
 * For a top-level field name, find the namespace (table alias) that contributed it. When exactly one namespace owns the field, the top-level binding is unambiguously column-bound and we record that `(table, column)` pair on the `ExpressionImpl` so encode-side dispatch (`forColumn`) and the `validateParamRefRefs` pass can find it. The AST stays as `IdentifierRef` to preserve SQL rendering — adapters render top-level
 * identifiers without an explicit table qualifier — so this change is metadata-only and produces no SQL drift.
 */
function findUniqueNamespaceFor(scope: Scope, fieldName: string): string | undefined {
  let found: string | undefined;
  for (const [namespace, fields] of Object.entries(scope.namespaces)) {
    if (Object.hasOwn(fields, fieldName)) {
      if (found !== undefined) return undefined;
      found = namespace;
    }
  }
  return found;
}

export function createFieldProxy<S extends Scope>(scope: S): FieldProxy<S> {
  return new Proxy({} as FieldProxy<S>, {
    get(_target, prop: string) {
      if (Object.hasOwn(scope.topLevel, prop)) {
        const topField = scope.topLevel[prop];
        if (topField) {
          const namespace = findUniqueNamespaceFor(scope, prop);
          const refs = namespace ? { table: namespace, column: prop } : undefined;
          return new ExpressionImpl(IdentifierRef.of(prop), topField, refs);
        }
      }

      if (Object.hasOwn(scope.namespaces, prop)) {
        const nsFields = scope.namespaces[prop];
        if (nsFields) return createNamespaceProxy(prop, nsFields);
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
      if (Object.hasOwn(fields, prop)) {
        const field = fields[prop];
        if (field) return new ExpressionImpl(ColumnRef.of(namespaceName, prop), field);
      }
      return undefined;
    },
  });
}
