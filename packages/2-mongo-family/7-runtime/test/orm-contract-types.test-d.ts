import type { InferModelRow, MongoModelsMap } from '@prisma-next/mongo-contract';
import { expectTypeOf, test } from 'vitest';
import type {
  CodecTypes,
  Contract,
} from '../../1-foundation/mongo-contract/test/fixtures/orm-contract';

test('InferModelRow resolves Task fields', () => {
  type TaskRow = InferModelRow<
    Contract,
    'Task',
    MongoModelsMap<Contract>['Task']['fields'],
    CodecTypes
  >;
  expectTypeOf({} as TaskRow).toExtend<{
    _id: string;
    title: string;
    type: string;
    assigneeId: string;
  }>();
});

test('InferModelRow resolves User fields', () => {
  type UserRow = InferModelRow<
    Contract,
    'User',
    MongoModelsMap<Contract>['User']['fields'],
    CodecTypes
  >;
  expectTypeOf({} as UserRow).toExtend<{
    _id: string;
    name: string;
    email: string;
    loginCount: number;
    tags: string[];
    homeAddress: { city: string; country: string } | null;
  }>();
});

test('InferModelRow resolves embedded model fields', () => {
  type AddressRow = InferModelRow<
    Contract,
    'Address',
    MongoModelsMap<Contract>['Address']['fields'],
    CodecTypes
  >;
  expectTypeOf({} as AddressRow).toExtend<{
    street: string;
    city: string;
    zip: string;
  }>();
});

test('InferModelRow resolves variant model fields', () => {
  type BugRow = InferModelRow<
    Contract,
    'Bug',
    MongoModelsMap<Contract>['Bug']['fields'],
    CodecTypes
  >;
  type FeatureRow = InferModelRow<
    Contract,
    'Feature',
    MongoModelsMap<Contract>['Feature']['fields'],
    CodecTypes
  >;
  expectTypeOf({} as BugRow).toExtend<{ severity: string }>();
  expectTypeOf({} as FeatureRow).toExtend<{
    priority: string;
    targetRelease: string;
  }>();
});

test('InferModelRow resolves Comment with date field', () => {
  type CommentRow = InferModelRow<
    Contract,
    'Comment',
    MongoModelsMap<Contract>['Comment']['fields'],
    CodecTypes
  >;
  expectTypeOf({} as CommentRow).toExtend<{
    _id: string;
    text: string;
    createdAt: Date;
  }>();
});
