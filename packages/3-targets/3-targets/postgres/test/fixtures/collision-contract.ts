import type {
  Contract,
  NamespaceId,
  ProfileHashBase,
  StorageHashBase,
} from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

/**
 * A hand-built, fully-typed Postgres contract whose namespaces include one named
 * `storage` — colliding with the contract envelope's `storage` field — alongside
 * a normal `public` schema. There is no committed emitted fixture with a
 * `@@schema("storage")` model, so this typed `Contract` stands in to prove the
 * collision-safety rule at the type level (and is reused for the runtime test).
 * It is a real `Contract<SqlStorage>` — the view's type behaviour over it is
 * identical to behaviour over an emitted contract of the same shape.
 */

type IdColumn = {
  readonly nativeType: 'int4';
  readonly codecId: 'pg/int4@1';
  readonly nullable: false;
};

type StorageSchemaTable = {
  readonly secrets: {
    readonly columns: { readonly id: IdColumn };
    readonly primaryKey: { readonly columns: readonly ['id'] };
    readonly uniques: readonly [];
    readonly indexes: readonly [];
    readonly foreignKeys: readonly [];
  };
};

type PublicSchemaTable = {
  readonly widgets: {
    readonly columns: { readonly id: IdColumn };
    readonly primaryKey: { readonly columns: readonly ['id'] };
    readonly uniques: readonly [];
    readonly indexes: readonly [];
    readonly foreignKeys: readonly [];
  };
};

export type CollisionContract = Contract<
  SqlStorage & {
    readonly storageHash: StorageHashBase<'sha256:collision'>;
    readonly namespaces: {
      readonly storage: {
        readonly id: 'storage' & NamespaceId;
        readonly kind: 'postgres-schema';
        readonly entries: { readonly table: StorageSchemaTable };
      };
      readonly public: {
        readonly id: 'public' & NamespaceId;
        readonly kind: 'postgres-schema';
        readonly entries: { readonly table: PublicSchemaTable };
      };
    };
  }
> & {
  readonly target: 'postgres';
  readonly targetFamily: 'sql';
  readonly profileHash: ProfileHashBase<'sha256:collision'>;
};

/**
 * A runtime value structurally matching {@link CollisionContract}. Hand-built
 * (no serializer round-trip needed) — the view layering is structural and does
 * not depend on hydrated IR-class identity for this collision check.
 */
export const collisionContractValue = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:collision',
  capabilities: {},
  extensionPacks: {},
  meta: {},
  roots: {},
  domain: { namespaces: {} },
  storage: {
    storageHash: 'sha256:collision',
    namespaces: {
      storage: {
        id: 'storage',
        kind: 'postgres-schema',
        entries: {
          table: {
            secrets: {
              columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
      public: {
        id: 'public',
        kind: 'postgres-schema',
        entries: {
          table: {
            widgets: {
              columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
};
