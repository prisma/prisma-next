import {
  type CrossReference,
  crossRef,
  type ProfileHashBase,
  type StorageHashBase,
} from '@prisma-next/contract/types';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import { blindCast } from '@prisma-next/utils/casts';

type TestModels = {
  readonly Order: {
    readonly fields: {
      readonly _id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        readonly nullable: false;
      };
      readonly status: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
      };
      readonly amount: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/double@1' };
        readonly nullable: false;
      };
      readonly customerId: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        readonly nullable: false;
      };
      readonly notes: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: true;
      };
      readonly tags: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
        readonly many: true;
      };
      readonly createdAt: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' };
        readonly nullable: false;
      };
    };
    readonly relations: Record<string, never>;
    readonly storage: { readonly collection: 'orders' };
  };
  readonly User: {
    readonly fields: {
      readonly _id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        readonly nullable: false;
      };
      readonly firstName: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
      };
      readonly lastName: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
      };
      readonly email: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
      };
    };
    readonly relations: Record<string, never>;
    readonly storage: { readonly collection: 'users' };
  };
  /**
   * Fixture for value-object dot-path traversal (TML-2281). `address` is a
   * non-nullable `Address`, `workAddress` is a nullable `Address`, and
   * `stats` is a non-nullable `Stats`. `Address.geo` is itself a `GeoPoint`
   * value object, giving us a two-level nested path (`address.geo.lat`).
   */
  readonly Customer: {
    readonly fields: {
      readonly _id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        readonly nullable: false;
      };
      readonly name: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
      };
      readonly address: {
        readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
        readonly nullable: false;
      };
      readonly workAddress: {
        readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
        readonly nullable: true;
      };
      readonly stats: {
        readonly type: { readonly kind: 'valueObject'; readonly name: 'Stats' };
        readonly nullable: false;
      };
    };
    readonly relations: Record<string, never>;
    readonly storage: { readonly collection: 'customers' };
  };
};

type TestValueObjects = {
  readonly Address: {
    readonly fields: {
      readonly street: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
      };
      readonly city: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
      };
      readonly zip: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: true;
      };
      readonly geo: {
        readonly type: { readonly kind: 'valueObject'; readonly name: 'GeoPoint' };
        readonly nullable: false;
      };
    };
  };
  readonly GeoPoint: {
    readonly fields: {
      readonly lat: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/double@1' };
        readonly nullable: false;
      };
      readonly lng: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/double@1' };
        readonly nullable: false;
      };
    };
  };
  readonly Stats: {
    readonly fields: {
      readonly visits: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/double@1' };
        readonly nullable: false;
      };
      readonly lastSeen: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' };
        readonly nullable: true;
      };
    };
  };
};

type TestStorage = {
  readonly storageHash: StorageHashBase<'test-hash'>;
  readonly namespaces: {
    readonly __unbound__: {
      readonly id: '__unbound__';
      readonly kind: 'mongo-namespace';
      readonly entries: {
        readonly collection: {
          readonly orders: { readonly kind: 'mongo-collection' };
          readonly users: { readonly kind: 'mongo-collection' };
          readonly customers: { readonly kind: 'mongo-collection' };
        };
      };
    };
  };
};

export type TestContract = Omit<MongoContract<TestStorage>, 'domain'> & {
  readonly target: 'mongo';
  readonly targetFamily: 'mongo';
  readonly roots: {
    readonly orders: CrossReference & { readonly model: 'Order' };
    readonly users: CrossReference & { readonly model: 'User' };
    readonly customers: CrossReference & { readonly model: 'Customer' };
  };
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly models: TestModels;
        readonly valueObjects: TestValueObjects;
      };
    };
  };
  readonly profileHash: ProfileHashBase<'test-profile'>;
  readonly capabilities: Record<string, never>;
  readonly extensionPacks: Record<string, never>;
  readonly meta: Record<string, never>;
};

export type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly output: string };
  readonly 'mongo/string@1': { readonly output: string };
  readonly 'mongo/double@1': { readonly output: number };
  readonly 'mongo/array@1': { readonly output: unknown[] };
  readonly 'mongo/null@1': { readonly output: null };
  readonly 'mongo/bool@1': { readonly output: boolean };
  readonly 'mongo/date@1': { readonly output: Date };
};

type TestFieldOutputTypes = {
  readonly __unbound__: {
    readonly Order: {
      readonly _id: string;
      readonly status: string;
      readonly amount: number;
      readonly customerId: string;
      readonly notes: string | null;
      readonly tags: string[];
      readonly createdAt: Date;
    };
    readonly User: {
      readonly _id: string;
      readonly firstName: string;
      readonly lastName: string;
      readonly email: string;
    };
    readonly Customer: {
      readonly _id: string;
      readonly name: string;
      readonly address: {
        street: string;
        city: string;
        zip: string | null;
        geo: { lat: number; lng: number };
      };
      readonly workAddress: {
        street: string;
        city: string;
        zip: string | null;
        geo: { lat: number; lng: number };
      } | null;
      readonly stats: { visits: number; lastSeen: Date | null };
    };
  };
};

type TestFieldInputTypes = TestFieldOutputTypes;

export type TestTypeMaps = MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes, TestFieldInputTypes>;
export type TContract = MongoContractWithTypeMaps<TestContract, TestTypeMaps>;

export const testContractJson = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: {
    orders: crossRef('Order'),
    users: crossRef('User'),
    customers: crossRef('Customer'),
  },
  domain: {
    namespaces: {
      __unbound__: {
        models: {
          Order: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              status: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              amount: { type: { kind: 'scalar', codecId: 'mongo/double@1' }, nullable: false },
              customerId: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
              },
              notes: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: true },
              tags: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: true,
              },
              createdAt: { type: { kind: 'scalar', codecId: 'mongo/date@1' }, nullable: false },
            },
            relations: {},
            storage: { collection: 'orders' },
          },
          User: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              firstName: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              lastName: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              email: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            relations: {},
            storage: { collection: 'users' },
          },
          Customer: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              name: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              address: { type: { kind: 'valueObject', name: 'Address' }, nullable: false },
              workAddress: { type: { kind: 'valueObject', name: 'Address' }, nullable: true },
              stats: { type: { kind: 'valueObject', name: 'Stats' }, nullable: false },
            },
            relations: {},
            storage: { collection: 'customers' },
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              city: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              zip: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: true },
              geo: { type: { kind: 'valueObject', name: 'GeoPoint' }, nullable: false },
            },
          },
          GeoPoint: {
            fields: {
              lat: { type: { kind: 'scalar', codecId: 'mongo/double@1' }, nullable: false },
              lng: { type: { kind: 'scalar', codecId: 'mongo/double@1' }, nullable: false },
            },
          },
          Stats: {
            fields: {
              visits: { type: { kind: 'scalar', codecId: 'mongo/double@1' }, nullable: false },
              lastSeen: { type: { kind: 'scalar', codecId: 'mongo/date@1' }, nullable: true },
            },
          },
        },
      },
    },
  },
  storage: {
    storageHash: 'test-hash',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        kind: 'mongo-namespace',
        collections: {
          orders: { kind: 'mongo-collection' },
          users: { kind: 'mongo-collection' },
          customers: { kind: 'mongo-collection' },
        },
      },
    },
  },
  capabilities: {},
  extensionPacks: {},
  profileHash: 'test-profile',
  meta: {},
};

export const testContract = blindCast<
  TContract,
  'query-builder fixture JSON carries domain.namespaces envelope'
>(testContractJson);

/**
 * Test-local operation→output-codec table mirroring the Mongo adapter's
 * declaration. Tests may name `mongo/*` codec ids; the family source may not.
 */
export const testOperationCodecs = {
  $concat: 'mongo/string@1',
  $toLower: 'mongo/string@1',
  $toUpper: 'mongo/string@1',
  $toString: 'mongo/string@1',
  $substr: 'mongo/string@1',
  $substrBytes: 'mongo/string@1',
  $trim: 'mongo/string@1',
  $ltrim: 'mongo/string@1',
  $rtrim: 'mongo/string@1',
  $replaceOne: 'mongo/string@1',
  $replaceAll: 'mongo/string@1',
  $dateToString: 'mongo/string@1',
  $type: 'mongo/string@1',
  $eq: 'mongo/bool@1',
  $ne: 'mongo/bool@1',
  $gt: 'mongo/bool@1',
  $gte: 'mongo/bool@1',
  $lt: 'mongo/bool@1',
  $lte: 'mongo/bool@1',
  $in: 'mongo/bool@1',
  $regexMatch: 'mongo/bool@1',
  $isArray: 'mongo/bool@1',
  $toBool: 'mongo/bool@1',
  $setEquals: 'mongo/bool@1',
  $setIsSubset: 'mongo/bool@1',
  $anyElementTrue: 'mongo/bool@1',
  $allElementsTrue: 'mongo/bool@1',
  $toDate: 'mongo/date@1',
  $dateAdd: 'mongo/date@1',
  $dateSubtract: 'mongo/date@1',
  $dateTrunc: 'mongo/date@1',
  $dateFromString: 'mongo/date@1',
  $add: 'mongo/double@1',
  $subtract: 'mongo/double@1',
  $multiply: 'mongo/double@1',
  $divide: 'mongo/double@1',
  $size: 'mongo/double@1',
  $year: 'mongo/double@1',
  $month: 'mongo/double@1',
  $dayOfMonth: 'mongo/double@1',
  $hour: 'mongo/double@1',
  $minute: 'mongo/double@1',
  $second: 'mongo/double@1',
  $millisecond: 'mongo/double@1',
  $dateDiff: 'mongo/double@1',
  $strLenCP: 'mongo/double@1',
  $strLenBytes: 'mongo/double@1',
  $cmp: 'mongo/double@1',
  $indexOfArray: 'mongo/double@1',
  $toInt: 'mongo/double@1',
  $toLong: 'mongo/double@1',
  $toDouble: 'mongo/double@1',
  $toDecimal: 'mongo/double@1',
  $count: 'mongo/double@1',
  $toObjectId: 'mongo/objectId@1',
} as const;

export type TestOperationCodecs = typeof testOperationCodecs;
