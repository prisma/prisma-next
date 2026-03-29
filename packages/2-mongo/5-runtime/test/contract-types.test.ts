import type {
  ExtractMongoCodecTypes,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-core';
import { describe, it } from 'vitest';
import type { Contract } from './fixtures/contract';

type InferRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TFields extends Record<
    string,
    { codecId: string; nullable: boolean }
  > = TContract['models'][ModelName]['fields'],
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
> = {
  [FieldName in keyof TFields]: TFields[FieldName]['nullable'] extends true
    ? TCodecTypes[TFields[FieldName]['codecId']]['output'] | null
    : TCodecTypes[TFields[FieldName]['codecId']]['output'];
};

type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type UserRow = InferRow<Contract, 'User'>;
type PostRow = InferRow<Contract, 'Post'>;

type _AssertUser =
  AssertEqual<
    UserRow,
    {
      _id: string;
      name: string;
      email: string;
      bio: string | null;
      createdAt: Date;
    }
  > extends true
    ? true
    : 'UserRow type mismatch';

type _AssertPost =
  AssertEqual<
    PostRow,
    {
      _id: string;
      title: string;
      slug: string;
      content: string;
      status: string;
      authorId: string;
      viewCount: number;
      publishedAt: Date | null;
      updatedAt: Date;
    }
  > extends true
    ? true
    : 'PostRow type mismatch';

void (true as _AssertUser);
void (true as _AssertPost);

describe('InferRow', () => {
  it('resolves User fields from contract', () => {
    const _row: UserRow = {} as UserRow;
    const _name: string = _row.name;
    const _bio: string | null = _row.bio;
    const _id: string = _row._id;
    const _createdAt: Date = _row.createdAt;
    void [_name, _bio, _id, _createdAt];
  });

  it('resolves Post fields from contract', () => {
    const _row: PostRow = {} as PostRow;
    const _viewCount: number = _row.viewCount;
    const _publishedAt: Date | null = _row.publishedAt;
    const _authorId: string = _row.authorId;
    void [_viewCount, _publishedAt, _authorId];
  });
});
