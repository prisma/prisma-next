import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-core';

type TaskModel = {
  readonly storage: { readonly collection: 'tasks' };
  readonly fields: {
    readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
    readonly title: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly type: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly assigneeId: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
  };
  readonly relations: {
    readonly assignee: {
      readonly to: 'User';
      readonly cardinality: 'N:1';
      readonly strategy: 'reference';
      readonly on: {
        readonly localFields: readonly ['assigneeId'];
        readonly targetFields: readonly ['_id'];
      };
    };
    readonly comments: {
      readonly to: 'Comment';
      readonly cardinality: '1:N';
      readonly strategy: 'embed';
      readonly field: 'comments';
    };
  };
  readonly discriminator: { readonly field: 'type' };
  readonly variants: {
    readonly Bug: { readonly value: 'bug' };
    readonly Feature: { readonly value: 'feature' };
  };
};

type BugModel = {
  readonly storage: { readonly collection: 'tasks' };
  readonly fields: {
    readonly severity: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  };
  readonly relations: Record<string, never>;
};

type FeatureModel = {
  readonly storage: { readonly collection: 'tasks' };
  readonly fields: {
    readonly priority: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly targetRelease: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  };
  readonly relations: Record<string, never>;
};

type UserModel = {
  readonly storage: { readonly collection: 'users' };
  readonly fields: {
    readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
    readonly name: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly email: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  };
  readonly relations: {
    readonly addresses: {
      readonly to: 'Address';
      readonly cardinality: '1:N';
      readonly strategy: 'embed';
      readonly field: 'addresses';
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
};

type CommentModel = {
  readonly storage: Record<string, never>;
  readonly fields: {
    readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
    readonly text: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    readonly createdAt: { readonly codecId: 'mongo/date@1'; readonly nullable: false };
  };
  readonly relations: Record<string, never>;
};

type OrmContract = MongoContract<
  {
    readonly tasks: 'Task';
    readonly users: 'User';
  },
  {
    readonly collections: {
      readonly tasks: Record<string, never>;
      readonly users: Record<string, never>;
    };
  },
  {
    readonly Task: TaskModel;
    readonly Bug: BugModel;
    readonly Feature: FeatureModel;
    readonly User: UserModel;
    readonly Address: AddressModel;
    readonly Comment: CommentModel;
  }
>;

type OrmCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/date@1': { readonly input: Date; readonly output: Date };
};

type OrmTypeMaps = MongoTypeMaps<OrmCodecTypes>;

export type Contract = MongoContractWithTypeMaps<OrmContract, OrmTypeMaps>;
export type TypeMaps = OrmTypeMaps;
