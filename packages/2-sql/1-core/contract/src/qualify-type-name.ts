import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';

/**
 * Schema-qualifies a named SQL type for a namespace: `${namespaceId}.${typeName}`
 * when `namespaceId` is defined and neither the target's default namespace nor the
 * unbound singleton namespace, otherwise the bare `typeName`. Generic across SQL
 * targets — callers supply their own target's default namespace id (e.g. Postgres's
 * `'public'`), since that value is target-specific, not a framework constant.
 */
export function qualifyTypeName(
  typeName: string,
  namespaceId: string | undefined,
  defaultNamespaceId: string | undefined,
): string {
  const shouldQualify =
    namespaceId !== undefined &&
    namespaceId !== defaultNamespaceId &&
    namespaceId !== UNBOUND_NAMESPACE_ID;
  return shouldQualify ? `${namespaceId}.${typeName}` : typeName;
}
