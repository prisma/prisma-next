import type { InferModelRow } from '@prisma-next/mongo-core';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/orm-contract';

test('roots maps accessor names to model names', () => {
  type Roots = Contract['roots'];
  expectTypeOf({} as Roots).toEqualTypeOf<{
    readonly tasks: 'Task';
    readonly users: 'User';
  }>();
});

test('model fields carry codecId and nullable', () => {
  type TaskFields = Contract['models']['Task']['fields'];
  expectTypeOf({} as TaskFields['_id']).toEqualTypeOf<{
    readonly codecId: 'mongo/objectId@1';
    readonly nullable: false;
  }>();
  expectTypeOf({} as TaskFields['title']).toEqualTypeOf<{
    readonly codecId: 'mongo/string@1';
    readonly nullable: false;
  }>();
});

test('root models have storage.collection, embedded models do not', () => {
  type TaskStorage = Contract['models']['Task']['storage'];
  type AddressStorage = Contract['models']['Address']['storage'];
  expectTypeOf({} as TaskStorage).toEqualTypeOf<{ readonly collection: 'tasks' }>();
  expectTypeOf({} as AddressStorage).toEqualTypeOf<Record<string, never>>();
});

test('Task has discriminator and variants', () => {
  type TaskDisc = NonNullable<Contract['models']['Task']['discriminator']>;
  type TaskVars = NonNullable<Contract['models']['Task']['variants']>;
  expectTypeOf({} as TaskDisc).toEqualTypeOf<{ readonly field: 'type' }>();
  expectTypeOf({} as TaskVars).toEqualTypeOf<{
    readonly Bug: { readonly value: 'bug' };
    readonly Feature: { readonly value: 'feature' };
  }>();
});

test('reference relation has strategy and on', () => {
  type AssigneeRel = Contract['models']['Task']['relations']['assignee'];
  expectTypeOf({} as AssigneeRel).toEqualTypeOf<{
    readonly to: 'User';
    readonly cardinality: 'N:1';
    readonly strategy: 'reference';
    readonly on: {
      readonly localFields: readonly ['assigneeId'];
      readonly targetFields: readonly ['_id'];
    };
  }>();
});

test('embed relation has strategy and field', () => {
  type CommentsRel = Contract['models']['Task']['relations']['comments'];
  expectTypeOf({} as CommentsRel).toEqualTypeOf<{
    readonly to: 'Comment';
    readonly cardinality: '1:N';
    readonly strategy: 'embed';
    readonly field: 'comments';
  }>();
});

test('variant models have base backreference', () => {
  type BugBase = Contract['models']['Bug']['base'];
  type FeatureBase = Contract['models']['Feature']['base'];
  expectTypeOf({} as BugBase).toEqualTypeOf<'Task'>();
  expectTypeOf({} as FeatureBase).toEqualTypeOf<'Task'>();
});

test('InferModelRow resolves Task fields', () => {
  type TaskRow = InferModelRow<Contract, 'Task'>;
  expectTypeOf({} as TaskRow).toEqualTypeOf<{
    _id: string;
    title: string;
    type: string;
    assigneeId: string;
  }>();
});

test('InferModelRow resolves User fields', () => {
  type UserRow = InferModelRow<Contract, 'User'>;
  expectTypeOf({} as UserRow).toEqualTypeOf<{
    _id: string;
    name: string;
    email: string;
  }>();
});

test('InferModelRow resolves embedded model fields', () => {
  type AddressRow = InferModelRow<Contract, 'Address'>;
  expectTypeOf({} as AddressRow).toEqualTypeOf<{
    street: string;
    city: string;
    zip: string;
  }>();
});

test('InferModelRow resolves variant model fields', () => {
  type BugRow = InferModelRow<Contract, 'Bug'>;
  type FeatureRow = InferModelRow<Contract, 'Feature'>;
  expectTypeOf({} as BugRow).toEqualTypeOf<{ severity: string }>();
  expectTypeOf({} as FeatureRow).toEqualTypeOf<{
    priority: string;
    targetRelease: string;
  }>();
});

test('InferModelRow resolves Comment with date field', () => {
  type CommentRow = InferModelRow<Contract, 'Comment'>;
  expectTypeOf({} as CommentRow).toEqualTypeOf<{
    _id: string;
    text: string;
    createdAt: Date;
  }>();
});
