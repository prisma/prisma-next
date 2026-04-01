import type { IncludeResultFields, InferRootRow } from '@prisma-next/mongo-orm';
import type { Contract } from './contract';

export type UserRow = InferRootRow<Contract, 'User'>;
export type PostRow = InferRootRow<Contract, 'Post'>;

export type PostWithAuthor = PostRow & IncludeResultFields<Contract, 'Post', { author: true }>;

type Serialized<T> = T extends Date
  ? string
  : T extends ReadonlyArray<infer U>
    ? Serialized<U>[]
    : T extends Record<string, unknown>
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

export type ApiPost = Serialized<PostWithAuthor>;
export type ApiUser = Serialized<UserRow>;
