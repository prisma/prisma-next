export type NamespaceId = string & { readonly __brand: 'NamespaceId' };

export function asNamespaceId(value: string): NamespaceId {
  return value as NamespaceId;
}
