import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { Collection } from '../src/collection';
import type {
  CreateInput,
  DefaultModelInputRow,
  DefaultModelRow,
  InferRootRow,
  MutationUpdateInput,
  ShorthandWhereFilter,
  UniqueConstraintCriterion,
} from '../src/types';

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
  matchesPlaintext: {
    args: [{ codecId: 'pg/secret@1'; nullable: false }, { codecId: 'pg/text@1'; nullable: false }];
    returns: { codecId: 'pg/bool@1'; nullable: false };
  };
};

type AsyncFieldOutputTypes = {
  User: {
    id: string;
    secret: Promise<string>;
  };
  Post: {
    id: string;
    userId: string;
    title: string;
  };
};

type AsyncFieldInputTypes = {
  User: {
    id: string;
    secret: string;
  };
  Post: {
    id: string;
    userId: string;
    title: string;
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
      posts: {
        columns: {
          id: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          user_id: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          title: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
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
      relations: {
        posts: {
          to: 'Post';
          cardinality: '1:N';
          on: {
            localFields: readonly ['id'];
            targetFields: readonly ['userId'];
          };
        };
      };
    };
    Post: {
      storage: {
        table: 'posts';
        fields: {
          id: { column: 'id' };
          userId: { column: 'user_id' };
          title: { column: 'title' };
        };
      };
      fields: {
        id: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: false;
        };
        userId: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: false;
        };
        title: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: false;
        };
      };
      relations: Record<string, never>;
    };
  }
>;

type AsyncContract = ContractWithTypeMaps<AsyncContractBase, AsyncTypeMaps>;

declare const users: Collection<AsyncContract, 'User'>;

test('ORM read-side row types surface promise-valued async codec fields', () => {
  expectTypeOf<DefaultModelRow<AsyncContract, 'User'>['id']>().toEqualTypeOf<string>();
  expectTypeOf<DefaultModelRow<AsyncContract, 'User'>['secret']>().toEqualTypeOf<Promise<string>>();
  expectTypeOf<InferRootRow<AsyncContract, 'User'>['secret']>().toEqualTypeOf<Promise<string>>();
  expectTypeOf<DefaultModelInputRow<AsyncContract, 'User'>['secret']>().toEqualTypeOf<string>();
});

test('ORM select() and include() keep async outputs on read-side rows only', () => {
  const selected = users.select('secret');
  const withPosts = users.include('posts');

  type SelectedRow = Awaited<ReturnType<typeof selected.first>>;
  type IncludedRow = Awaited<ReturnType<typeof withPosts.first>>;

  expectTypeOf<NonNullable<SelectedRow>>().toEqualTypeOf<{
    secret: Promise<string>;
  }>();
  expectTypeOf<NonNullable<IncludedRow>>().toEqualTypeOf<{
    id: string;
    secret: Promise<string>;
    posts: {
      id: string;
      userId: string;
      title: string;
    }[];
  }>();
});

test('ORM filters, accessors, cursor values, and mutation inputs keep async codec fields on plain input types', () => {
  users.where((user) => user.secret.eq('cleartext'));
  users.where((user) => user.secret.matchesPlaintext('cleartext'));
  users.where({ secret: 'cleartext' });
  users.orderBy((user) => user.id.asc()).cursor({ secret: 'cleartext' });
  users.create({ id: 'user_001', secret: 'cleartext' });
  users.upsert({
    create: { id: 'user_001', secret: 'cleartext' },
    update: { secret: 'rotated' },
    conflictOn: { id: 'user_001' },
  });
  users.where({ id: 'user_001' }).update({ secret: 'rotated' });
  users.where({ id: 'user_001' }).updateAll({ secret: 'rotated' });
  users.where({ id: 'user_001' }).updateCount({ secret: 'rotated' });

  // @ts-expect-error async codec filters accept plain inputs, not promise outputs
  users.where((user) => user.secret.eq(Promise.resolve('cleartext')));
  // @ts-expect-error async codec query operation args accept plain inputs, not promise outputs
  users.where((user) => user.secret.matchesPlaintext(Promise.resolve('cleartext')));
  // @ts-expect-error shorthand filters keep input-side values
  users.where({ secret: Promise.resolve('cleartext') });
  // @ts-expect-error cursor values keep input-side values
  users.orderBy((user) => user.id.asc()).cursor({ secret: Promise.resolve('cleartext') });
  // @ts-expect-error create inputs keep input-side values
  users.create({ id: 'user_001', secret: Promise.resolve('cleartext') });
  // @ts-expect-error update inputs keep input-side values
  users.where({ id: 'user_001' }).update({ secret: Promise.resolve('rotated') });
});

type AsyncWhere = ShorthandWhereFilter<AsyncContract, 'User'>;
type AsyncCreateInput = CreateInput<AsyncContract, 'User'>;
type AsyncUpdateInput = MutationUpdateInput<AsyncContract, 'User'>;
type AsyncUniqueCriterion = UniqueConstraintCriterion<AsyncContract, 'User'>;

test('exported ORM helper types stay on input-side values for writes and criteria', () => {
  expectTypeOf<AsyncWhere['secret']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<AsyncCreateInput['secret']>().toEqualTypeOf<string>();
  expectTypeOf<AsyncUpdateInput['secret']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<AsyncUniqueCriterion['id']>().toEqualTypeOf<string>();
});
