import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';

type UserModel = {
  readonly storage: { readonly collection: 'users' };
  readonly fields: {
    readonly _id: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
    };
    readonly name: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly email: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly bio: {
      readonly nullable: true;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly createdAt: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' };
    };
  };
  readonly relations: {
    readonly posts: {
      readonly to: 'Post';
      readonly cardinality: '1:N';
      readonly on: {
        readonly localFields: readonly ['_id'];
        readonly targetFields: readonly ['authorId'];
      };
    };
  };
};

type PostModel = {
  readonly storage: { readonly collection: 'posts' };
  readonly fields: {
    readonly _id: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
    };
    readonly title: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly slug: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly content: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly status: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly authorId: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
    };
    readonly viewCount: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/int32@1' };
    };
    readonly publishedAt: {
      readonly nullable: true;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' };
    };
    readonly updatedAt: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' };
    };
  };
  readonly relations: {
    readonly author: {
      readonly to: 'User';
      readonly cardinality: 'N:1';
      readonly on: {
        readonly localFields: readonly ['authorId'];
        readonly targetFields: readonly ['_id'];
      };
    };
  };
};

type BlogContract = MongoContract<
  {
    readonly users: 'User';
    readonly posts: 'Post';
  },
  {
    readonly collections: {
      readonly users: Record<string, never>;
      readonly posts: Record<string, never>;
    };
  },
  {
    readonly User: UserModel;
    readonly Post: PostModel;
  }
>;

type BlogCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/int32@1': { readonly input: number; readonly output: number };
  readonly 'mongo/date@1': { readonly input: Date; readonly output: Date };
};

type BlogTypeMaps = MongoTypeMaps<BlogCodecTypes>;

export type Contract = MongoContractWithTypeMaps<BlogContract, BlogTypeMaps>;
export type TypeMaps = BlogTypeMaps;
