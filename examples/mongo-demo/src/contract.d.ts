import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-core';

type UserModel = {
  readonly storage: {
    readonly collection: 'users';
    readonly relations: { readonly addresses: { readonly field: 'addresses' } };
  };
  readonly fields: {
    readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
    readonly name: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly email: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
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
    readonly addresses: {
      readonly to: 'Address';
      readonly cardinality: '1:N';
    };
  };
};

type AddressModel = {
  readonly storage: Record<string, never>;
  readonly fields: {
    readonly street: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly city: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly zip: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  };
  readonly relations: Record<string, never>;
  readonly owner: 'User';
};

type PostModel = {
  readonly storage: {
    readonly collection: 'posts';
    readonly relations: { readonly comments: { readonly field: 'comments' } };
  };
  readonly fields: {
    readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
    readonly title: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly content: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly authorId: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
    readonly createdAt: { readonly codecId: 'mongo/date@1'; readonly nullable: false };
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
    readonly comments: {
      readonly to: 'Comment';
      readonly cardinality: '1:N';
    };
  };
};

type CommentModel = {
  readonly storage: Record<string, never>;
  readonly fields: {
    readonly text: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly createdAt: { readonly codecId: 'mongo/date@1'; readonly nullable: false };
  };
  readonly relations: Record<string, never>;
  readonly owner: 'Post';
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
    readonly Address: AddressModel;
    readonly Post: PostModel;
    readonly Comment: CommentModel;
  }
>;

type BlogCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/date@1': { readonly input: Date; readonly output: Date };
};

type BlogTypeMaps = MongoTypeMaps<BlogCodecTypes>;

export type Contract = MongoContractWithTypeMaps<BlogContract, BlogTypeMaps>;
export type TypeMaps = BlogTypeMaps;
