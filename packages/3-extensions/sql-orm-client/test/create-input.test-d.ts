import type { SqlContract } from '@prisma-next/sql-contract/types';
import type { CreateInput } from '../src/types';

type CreateInputContract = SqlContract<
  {
    tables: {
      user: {
        columns: {
          id: {
            nativeType: 'int4';
            codecId: 'pg/int4@1';
            nullable: false;
            default: {
              kind: 'function';
              expression: "nextval('user_id_seq'::regclass)";
            };
          };
          email: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          name: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: true };
          slug: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          created_at: {
            nativeType: 'timestamptz';
            codecId: 'pg/text@1';
            nullable: false;
            default: {
              kind: 'function';
              expression: 'now()';
            };
          };
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
      storage: { table: 'user' };
      fields: {
        id: { column: 'id' };
        email: { column: 'email' };
        name: { column: 'name' };
        slug: { column: 'slug' };
        createdAt: { column: 'created_at' };
      };
      relations: Record<string, never>;
    };
  },
  {
    user: Record<string, never>;
  },
  {
    modelToTable: {
      User: 'user';
    };
    tableToModel: {
      user: 'User';
    };
    fieldToColumn: {
      User: {
        id: 'id';
        email: 'email';
        name: 'name';
        slug: 'slug';
        createdAt: 'created_at';
      };
    };
    columnToField: {
      user: {
        id: 'id';
        email: 'email';
        name: 'name';
        slug: 'slug';
        created_at: 'createdAt';
      };
    };
    codecTypes: {
      'pg/int4@1': { output: number };
      'pg/text@1': { output: string };
    };
    operationTypes: Record<string, never>;
  }
> & {
  readonly execution: {
    readonly mutations: {
      readonly defaults: [
        {
          readonly ref: { readonly table: 'user'; readonly column: 'slug' };
          readonly onCreate: {
            readonly kind: 'generator';
            readonly id: 'uuidv4';
          };
        },
      ];
    };
  };
};

type Input = CreateInput<CreateInputContract, 'User'>;

type RequiredKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K;
}[keyof T];

type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Assert<T extends true> = T;

export type CreateInputTypeAssertions = [
  Assert<Equal<RequiredKeys<Input>, 'email'>>,
  Assert<Equal<OptionalKeys<Input>, 'id' | 'name' | 'slug' | 'createdAt'>>,
];
