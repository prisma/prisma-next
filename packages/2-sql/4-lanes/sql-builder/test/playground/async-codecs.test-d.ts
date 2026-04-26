import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { expectTypeOf, test } from 'vitest';
import type { Db } from '../../src';

type AsyncCodecTypes = {
  'pg/text@1': {
    input: string;
    output: string;
    traits: 'equality' | 'order' | 'textual';
  };
  'pg/secret@1': {
    input: string;
    output: Promise<string>;
    traits: 'equality' | 'order' | 'textual';
  };
  'pg/bool@1': {
    input: boolean;
    output: boolean;
    traits: 'equality' | 'boolean';
  };
};

type AsyncQueryOperationTypes = {
  secretMatches: {
    args: [{ codecId: 'pg/secret@1'; nullable: false }, { codecId: 'pg/text@1'; nullable: false }];
    returns: { codecId: 'pg/bool@1'; nullable: false };
  };
};

type AsyncFieldOutputTypes = {
  User: {
    id: string;
    secret: Promise<string>;
  };
};

type AsyncFieldInputTypes = {
  User: {
    id: string;
    secret: string;
  };
};

type AsyncTypeMaps = TypeMaps<
  AsyncCodecTypes,
  Record<string, never>,
  AsyncQueryOperationTypes,
  AsyncFieldOutputTypes,
  AsyncFieldInputTypes
>;

type AsyncContractBase = Contract<
  {
    storageHash: StorageHashBase<string>;
    tables: {
      users: {
        columns: {
          id: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          secret: { nativeType: 'text'; codecId: 'pg/secret@1'; nullable: false };
        };
        primaryKey: { columns: ['id'] };
        uniques: [];
        indexes: [];
        foreignKeys: [];
      };
    };
  },
  {
    User: {
      storage: {
        table: 'users';
        fields: {
          id: { column: 'id' };
          secret: { column: 'secret' };
        };
      };
      fields: {
        id: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: false;
        };
        secret: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/secret@1' };
          readonly nullable: false;
        };
      };
      relations: Record<string, never>;
    };
  }
>;

type AsyncContract = ContractWithTypeMaps<AsyncContractBase, AsyncTypeMaps>;

declare const db: Db<AsyncContract>;

test('SELECT resolves async codec fields to promise-valued outputs', () => {
  const result = db.users.select('id', 'secret').build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: string; secret: Promise<string> }>>();
});

test('INSERT and UPDATE keep async codec fields on plain input types', () => {
  db.users.insert({ id: 'user_001', secret: 'cleartext' });
  db.users.update({ secret: 'rotated' });

  // @ts-expect-error async codec inputs stay on plain values
  db.users.insert({ id: 'user_001', secret: Promise.resolve('cleartext') });
  // @ts-expect-error async codec inputs stay on plain values
  db.users.update({ secret: Promise.resolve('rotated') });
});

test('predicates and extension function args keep async codec fields on plain input types', () => {
  const result = db.users
    .select('id')
    .where((f, fns) => fns.secretMatches(f.secret, 'cleartext'))
    .build();

  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: string }>>();

  db.users
    .select('id')
    .where((f, fns) => fns.eq(f.secret, 'cleartext'))
    .build();

  db.users
    .select('id')
    .where(
      // @ts-expect-error builder predicates accept input-side values, not promise outputs
      (f, fns) => fns.eq(f.secret, Promise.resolve('cleartext')),
    )
    .build();
  db.users
    .select('id')
    .where(
      // @ts-expect-error extension function args accept input-side values, not promise outputs
      (f, fns) => fns.secretMatches(f.secret, Promise.resolve('cleartext')),
    )
    .build();
});
