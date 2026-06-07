/**
 * Space-aware reference coordinate for a domain enum or storage value-set.
 *
 * `kind` names the source entity-kind:
 * - `'enum'` — the referenced entity lives in the domain plane's `enum` slot.
 * - `'value-set'` — the referenced entity lives in the storage plane's `valueSet` slot.
 *
 * `namespaceId` admits the `UNBOUND_NAMESPACE_ID` (`__unbound__`) sentinel for
 * single-namespace (unbound) references.
 *
 * Cross-space discrimination is presence-based: when `spaceId` is absent the
 * reference is local (same contract-space); when `spaceId` is present the
 * reference is cross-space. This mirrors the `ForeignKeyReference` carrier
 * convention — no separate tag field — so local refs are JSON-minimal.
 */
export interface ValueSetRef {
  readonly kind: 'enum' | 'value-set';
  readonly namespaceId: string;
  readonly name: string;
  readonly spaceId?: string;
}
