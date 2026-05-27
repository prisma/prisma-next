import type { InferModelRow } from '@prisma-next/mongo-contract';
import { expectTypeOf, test } from 'vitest';
import type { OrmTestContract } from './orm-test-contract-type';

test('InferModelRow resolves Task fields', () => {
  type TaskRow = InferModelRow<OrmTestContract, 'Task'>;
  expectTypeOf({} as TaskRow).toEqualTypeOf<{
    _id: string;
    title: string;
    type: string;
    assigneeId: string;
  }>();
});

test('InferModelRow resolves User fields', () => {
  type UserRow = InferModelRow<OrmTestContract, 'User'>;
  expectTypeOf({} as UserRow).toEqualTypeOf<{
    _id: string;
    name: string;
    email: string;
    loginCount: number;
    tags: string[];
    homeAddress: { city: string; country: string } | null;
  }>();
});

test('InferModelRow resolves embedded model fields', () => {
  type AddressRow = InferModelRow<OrmTestContract, 'Address'>;
  expectTypeOf({} as AddressRow).toEqualTypeOf<{
    street: string;
    city: string;
    zip: string;
  }>();
});

test('InferModelRow resolves variant model fields', () => {
  type BugRow = InferModelRow<OrmTestContract, 'Bug'>;
  type FeatureRow = InferModelRow<OrmTestContract, 'Feature'>;
  expectTypeOf({} as BugRow).toEqualTypeOf<{ severity: string }>();
  expectTypeOf({} as FeatureRow).toEqualTypeOf<{
    priority: string;
    targetRelease: string;
  }>();
});

test('InferModelRow resolves Comment with date field', () => {
  type CommentRow = InferModelRow<OrmTestContract, 'Comment'>;
  expectTypeOf({} as CommentRow).toEqualTypeOf<{
    _id: string;
    text: string;
    createdAt: Date;
  }>();
});
