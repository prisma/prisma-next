import type { CodecTypes as PgTypes } from '@prisma-next/adapter-postgres/codec-types';
import type { CoreHashBase, ProfileHashBase } from '@prisma-next/contract/types';
import type { CodecTypes as PgVectorTypes } from '@prisma-next/extension-pgvector/codec-types';
import type { OperationTypes as PgVectorOperationTypes } from '@prisma-next/extension-pgvector/operation-types';
import type { SqlContract } from '@prisma-next/sql-contract/types';
import type { Kysely } from 'kysely';
import type { KyselifyContract } from './kyselify';

type CodecTypes = PgTypes & PgVectorTypes;

type CoreHash =
  CoreHashBase<'sha256:97998a9dc27b4ffdd7258e171236148b81c220a194d7adadbdb47ff28b476766'>;
type ProfileHash =
  ProfileHashBase<'sha256:58a1990244c9a8cf20e2f77c60aa35d2f6ea9823f641b533a9e75abc8606819f'>;

type Contract = SqlContract<
  {
    readonly tables: {
      readonly user: {
        columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly email: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
          readonly createdAt: {
            readonly nativeType: 'timestamptz';
            readonly codecId: 'pg/timestamptz@1';
            readonly nullable: false;
          };
        };
        primaryKey: { readonly columns: readonly ['id'] };
        uniques: readonly [];
        indexes: readonly [];
        foreignKeys: readonly [];
      };
      readonly post: {
        columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly title: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
          readonly userId: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly createdAt: {
            readonly nativeType: 'timestamptz';
            readonly codecId: 'pg/timestamptz@1';
            readonly nullable: false;
          };
          readonly embedding: {
            readonly nativeType: 'vector';
            readonly codecId: 'pg/vector@1';
            readonly nullable: true;
          };
        };
        primaryKey: { readonly columns: readonly ['id'] };
        uniques: readonly [];
        indexes: readonly [];
        foreignKeys: readonly [
          {
            readonly columns: readonly ['userId'];
            readonly references: { readonly table: 'user'; readonly columns: readonly ['id'] };
            readonly name: 'post_userId_fkey';
          },
        ];
      };
    };
    readonly types: Record<string, never>;
  },
  {
    readonly User: {
      storage: { readonly table: 'user' };
      fields: {
        readonly id: CodecTypes['pg/int4@1']['output'];
        readonly email: CodecTypes['pg/text@1']['output'];
        readonly createdAt: CodecTypes['pg/timestamptz@1']['output'];
      };
    };
    readonly Post: {
      storage: { readonly table: 'post' };
      fields: {
        readonly id: CodecTypes['pg/int4@1']['output'];
        readonly title: CodecTypes['pg/text@1']['output'];
        readonly userId: CodecTypes['pg/int4@1']['output'];
        readonly embedding: CodecTypes['pg/vector@1']['output'] | null;
        readonly createdAt: CodecTypes['pg/timestamptz@1']['output'];
      };
    };
  },
  {
    readonly user: {
      readonly posts: {
        readonly to: 'Post';
        readonly cardinality: '1:N';
        readonly on: {
          readonly parentCols: readonly ['id'];
          readonly childCols: readonly ['userId'];
        };
      };
    };
    readonly post: {
      readonly user: {
        readonly to: 'User';
        readonly cardinality: 'N:1';
        readonly on: {
          readonly parentCols: readonly ['userId'];
          readonly childCols: readonly ['id'];
        };
      };
    };
  },
  {
    modelToTable: { readonly User: 'user'; readonly Post: 'post' };
    tableToModel: { readonly user: 'User'; readonly post: 'Post' };
    fieldToColumn: {
      readonly User: {
        readonly id: 'id';
        readonly email: 'email';
        readonly createdAt: 'createdAt';
      };
      readonly Post: {
        readonly id: 'id';
        readonly title: 'title';
        readonly userId: 'userId';
        readonly embedding: 'embedding';
        readonly createdAt: 'createdAt';
      };
    };
    columnToField: {
      readonly user: {
        readonly id: 'id';
        readonly email: 'email';
        readonly createdAt: 'createdAt';
      };
      readonly post: {
        readonly id: 'id';
        readonly title: 'title';
        readonly userId: 'userId';
        readonly embedding: 'embedding';
        readonly createdAt: 'createdAt';
      };
    };
    codecTypes: PgTypes & PgVectorTypes;
    operationTypes: PgVectorOperationTypes;
  },
  CoreHash,
  ProfileHash
>;

type Database = KyselifyContract<Contract>;

async function foo(db: Kysely<Database>) {
  const result = await db
    .selectFrom('user')
    .innerJoin('post', (jb) => jb.onTrue())
    .select('post.id')
    .select('post.embedding')
    .executeTakeFirstOrThrow();

  result satisfies { id: number; embedding: number[] | null };

  return result;
}

foo.name;
