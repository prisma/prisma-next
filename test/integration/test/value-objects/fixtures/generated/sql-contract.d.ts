import type { CodecTypes as PgTypes } from '@prisma-next/adapter-postgres/codec-types';

import type {
  Contract as ContractShape,
  ExecutionHashBase,
  type NamespaceId,
  ProfileHashBase,
  StorageHashBase,
} from '@prisma-next/contract/types';
import type {
  ContractWithTypeMaps,
  TypeMaps as TypeMapsType,
} from '@prisma-next/sql-contract/types';

export type StorageHash = StorageHashBase<'sha256:vo-sql-test-storage-hash'>;
export type ExecutionHash = ExecutionHashBase<string>;
export type ProfileHash = ProfileHashBase<'sha256:vo-sql-test-profile-hash'>;

export type CodecTypes = PgTypes;
export type LaneCodecTypes = CodecTypes;
export type OperationTypes = Record<string, never>;
export type QueryOperationTypes = Record<string, never>;
type DefaultLiteralValue<CodecId extends string, _Encoded> = CodecId extends keyof CodecTypes
  ? CodecTypes[CodecId]['output']
  : _Encoded;

export type Location = {
  readonly street: CodecTypes['pg/text@1']['output'];
  readonly city: CodecTypes['pg/text@1']['output'];
  readonly zip: CodecTypes['pg/text@1']['output'];
};

export type TypeMaps = TypeMapsType<CodecTypes, OperationTypes, QueryOperationTypes>;

type ContractBase = ContractShape<
  {
    readonly types: Record<string, never>;
    readonly namespaces: {
      readonly __unbound__: {
        readonly id: '__unbound__';
        readonly kind: 'sql-namespace';
        readonly entries: { readonly table: {
          readonly shop: {
            columns: {
              readonly id: {
                readonly nativeType: 'int4';
                readonly codecId: 'pg/int4@1';
                readonly nullable: false;
                readonly default: {
                  readonly kind: 'function';
                  readonly expression: 'autoincrement()';
                };
              };
              readonly name: {
                readonly nativeType: 'text';
                readonly codecId: 'pg/text@1';
                readonly nullable: false;
              };
              readonly location: {
                readonly nativeType: 'jsonb';
                readonly codecId: 'pg/jsonb@1';
                readonly nullable: false;
              };
              readonly notes: {
                readonly nativeType: 'jsonb';
                readonly codecId: 'pg/jsonb@1';
                readonly nullable: true;
              };
            };
            primaryKey: { readonly columns: readonly ['id'] };
            uniques: readonly [];
            indexes: readonly [];
            foreignKeys: readonly [];
          };
        };
        };
        readonly types: Record<string, never>;
      };
    };
    readonly storageHash: StorageHash;
  },
  {
    readonly Shop: {
      readonly storage: {
        readonly table: 'shop';
        readonly namespaceId: '__unbound__';
        readonly fields: {
          readonly id: { readonly column: 'id' };
          readonly name: { readonly column: 'name' };
          readonly location: { readonly column: 'location' };
          readonly notes: { readonly column: 'notes' };
        };
      };
      readonly fields: {
        readonly id: {
          readonly nullable: false;
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        };
        readonly name: {
          readonly nullable: false;
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        };
        readonly location: {
          readonly nullable: false;
          readonly type: { readonly kind: 'valueObject'; readonly name: 'Location' };
        };
        readonly notes: {
          readonly nullable: true;
          readonly type: { readonly kind: 'valueObject'; readonly name: 'Location' };
        };
      };
      readonly relations: {};
    };
  }
> & {
  readonly target: 'postgres';
  readonly roots: { readonly shop: { readonly model: 'Shop'; readonly namespace: NamespaceId } };
  readonly capabilities: {
    readonly postgres: {
      readonly 'defaults.autoincrement': true;
      readonly returning: true;
    };
    readonly sql: { readonly returning: true };
  };
  readonly extensionPacks: {};
  readonly execution: {
    readonly mutations: { readonly defaults: readonly [] };
    readonly executionHash: string;
  };
  readonly valueObjects: {
    readonly Location: {
      readonly fields: {
        readonly street: {
          readonly nullable: false;
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        };
        readonly city: {
          readonly nullable: false;
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        };
        readonly zip: {
          readonly nullable: false;
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        };
      };
    };
  };
  readonly profileHash: ProfileHash;
};

export type Contract = ContractWithTypeMaps<ContractBase, TypeMaps>;

export type Tables = Contract['storage']['namespaces']['__unbound__']['entries']['table'];
export type Models = Contract['models'];
