import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-core';

type UserModel = {
  readonly storage: { readonly collection: 'users' };
  readonly fields: {
    readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
    readonly name: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly email: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly bio: { readonly codecId: 'mongo/string@1'; readonly nullable: true };
    readonly createdAt: { readonly codecId: 'mongo/date@1'; readonly nullable: false };
  };
  readonly relations: {
    readonly posts: {
      readonly to: 'Post';
      readonly cardinality: '1:N';
      readonly strategy: 'reference';
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
    readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
    readonly title: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly slug: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly content: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly status: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly authorId: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
    readonly viewCount: { readonly codecId: 'mongo/int32@1'; readonly nullable: false };
    readonly publishedAt: { readonly codecId: 'mongo/date@1'; readonly nullable: true };
    readonly updatedAt: { readonly codecId: 'mongo/date@1'; readonly nullable: false };
  };
  readonly relations: {
    readonly author: {
      readonly to: 'User';
      readonly cardinality: 'N:1';
      readonly strategy: 'reference';
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
