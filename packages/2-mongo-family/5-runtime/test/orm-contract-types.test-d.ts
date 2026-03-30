import type { InferModelRow } from '@prisma-next/mongo-core';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../1-core/test/fixtures/orm-contract';

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
