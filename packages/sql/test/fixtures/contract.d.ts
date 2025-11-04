// Contract type definitions
// Example: This pattern allows multiple contracts (e.g., authDataContract.d.ts, salesDataContract.d.ts)
// without namespace collisions. Each contract can have its own namespace name.

import type { SqlContract } from '../../src/contract-types';
import type { TableDef, ModelDef } from '../../src/types';
import type { CodecTypes, ScalarToJs } from '@prisma-next/adapter-postgres/codec-types';

// Contract type representing the contract data structure
// This type matches the structure of contract.json and can be used as a return type
export type Contract = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: { readonly type: 'int4'; nullable: false };
          readonly email: { readonly type: 'text'; nullable: false };
          readonly createdAt: { readonly type: 'timestamptz'; nullable: false };
        };
      };
    };
  },
  {
    readonly User: ModelDef<'User'> & {
      readonly id: number;
      readonly email: string;
      readonly createdAt: string;
    };
  },
  {},
  {
    readonly modelToTable: {
      readonly User: 'user';
    };
    readonly tableToModel: {
      readonly user: 'User';
    };
    readonly fieldToColumn: {
      readonly User: {
        readonly id: 'id';
        readonly email: 'email';
        readonly createdAt: 'createdAt';
      };
    };
    readonly columnToField: {
      readonly user: {
        readonly id: 'id';
        readonly email: 'email';
        readonly createdAt: 'createdAt';
      };
    };
    readonly scalarToJs: ScalarToJs;
  }
> & {
  readonly storage: {
    readonly tables: {
      readonly user: TableDef<'user'> & {
        readonly id: number;
        readonly email: string;
        readonly createdAt: string; // timestamptz maps to string in MVP
      };
    };
  };
};

// Codec type map and scalar mapping imported from adapter - used for type inference in lanes
export type { CodecTypes, ScalarToJs };

// Direct model exports for easy importing: import type { User } from './contract.d'
export type User = Contract['models']['User'];
