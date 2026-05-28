import type { InferModelRow } from '@prisma-next/mongo-contract';
import { expectTypeOf, test } from 'vitest';
import type {
  CodecTypes,
  Contract,
} from '../../1-foundation/mongo-contract/test/fixtures/orm-contract';

test('InferModelRow resolves Task fields', () => {
  type TaskRow = InferModelRow<Contract, 'Task', Contract['models']['Task']['fields'], CodecTypes>;
  expectTypeOf({} as TaskRow).toMatchTypeOf<{
    _id: string;
    title: string;
    type: string;
    assigneeId: string;
  }>();
});

test('InferModelRow resolves User fields', () => {
  type UserRow = InferModelRow<Contract, 'User', Contract['models']['User']['fields'], CodecTypes>;
  expectTypeOf({} as UserRow).toMatchTypeOf<{
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
    Contract['models']['Address']['fields'],
    CodecTypes
  >;
  expectTypeOf({} as AddressRow).toMatchTypeOf<{
    street: string;
    city: string;
    zip: string;
  }>();
});

test('InferModelRow resolves variant model fields', () => {
  type BugRow = InferModelRow<Contract, 'Bug', Contract['models']['Bug']['fields'], CodecTypes>;
  type FeatureRow = InferModelRow<
    Contract,
    'Feature',
    Contract['models']['Feature']['fields'],
    CodecTypes
  >;
  expectTypeOf({} as BugRow).toMatchTypeOf<{ severity: string }>();
  expectTypeOf({} as FeatureRow).toMatchTypeOf<{
    priority: string;
    targetRelease: string;
  }>();
});

test('InferModelRow resolves Comment with date field', () => {
  type CommentRow = InferModelRow<
    Contract,
    'Comment',
    Contract['models']['Comment']['fields'],
    CodecTypes
  >;
  expectTypeOf({} as CommentRow).toMatchTypeOf<{
    _id: string;
    text: string;
    createdAt: Date;
  }>();
});
