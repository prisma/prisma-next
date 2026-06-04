/**
 * Document shape of the `_prisma_migrations` control collection, declared
 * once so the contract-free field accessor is typed without threading a
 * contract, codecs, or paths at the call sites. Both the marker
 * documents (`space` / `storageHash` / … / `invariants`) and the ledger
 * documents (`type` / `edgeId` / … / `appliedAt`) live in this one
 * collection, so the shape is their union.
 */
export type ControlDocShape = {
  readonly _id: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  // Marker fields
  readonly space: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly storageHash: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly profileHash: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly contractJson: { readonly codecId: 'mongo/string@1'; readonly nullable: true };
  readonly canonicalVersion: { readonly codecId: 'mongo/double@1'; readonly nullable: true };
  readonly updatedAt: { readonly codecId: 'mongo/date@1'; readonly nullable: false };
  readonly appTag: { readonly codecId: 'mongo/string@1'; readonly nullable: true };
  readonly meta: { readonly codecId: 'mongo/document@1'; readonly nullable: true };
  readonly invariants: { readonly codecId: 'mongo/array@1'; readonly nullable: false };
  // Ledger fields
  readonly type: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly edgeId: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly from: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly to: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly migrationName: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly migrationHash: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly operations: { readonly codecId: 'mongo/array@1'; readonly nullable: false };
  readonly appliedAt: { readonly codecId: 'mongo/date@1'; readonly nullable: false };
};

export const CONTROL_COLLECTION = '_prisma_migrations';
