import type { CodecTypes as MongoCodecTypes } from '@prisma-next/adapter-mongo/codec-types';

import type { MongoContractWithTypeMaps, MongoTypeMaps } from '@prisma-next/mongo-contract';
import type { ProfileHashBase, StorageHashBase } from '@prisma-next/contract/types';

export type StorageHash =
  StorageHashBase<'sha256:vo-test-storage-hash'>;
export type ProfileHash =
  ProfileHashBase<'sha256:vo-test-profile-hash'>;

export type CodecTypes = MongoCodecTypes;
export type OperationTypes = Record<string, never>;
export type Location = {
  readonly street: CodecTypes['mongo/string@1']['output'];
  readonly city: CodecTypes['mongo/string@1']['output'];
  readonly zip: CodecTypes['mongo/string@1']['output'];
};
export type TypeMaps = MongoTypeMaps<CodecTypes, OperationTypes>;

type ContractBase = {
  readonly target: 'mongo';
  readonly targetFamily: 'mongo';
  readonly profileHash: ProfileHash;
  readonly capabilities: {};
  readonly extensionPacks: {};
  readonly meta: {};
  readonly roots: { readonly shop: 'Shop' };
  readonly models: {
    readonly Shop: {
      readonly fields: {
        readonly _id: {
          readonly nullable: false;
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        };
        readonly name: {
          readonly nullable: false;
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
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
      readonly relations: Record<string, never>;
      readonly storage: { readonly collection: 'shops' };
    };
  };
  readonly valueObjects: {
    readonly Location: {
      readonly fields: {
        readonly street: {
          readonly nullable: false;
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        };
        readonly city: {
          readonly nullable: false;
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        };
        readonly zip: {
          readonly nullable: false;
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        };
      };
    };
  };
  readonly storage: {
    readonly collections: {
      readonly shops: Record<string, never>;
    };
    readonly storageHash: StorageHash;
  };
};

export type Contract = MongoContractWithTypeMaps<ContractBase, TypeMaps>;
