// These types are manually constructed from the contract — they are NOT inferred
// from ORM query results. The ORM's `all()` and `first()` return `InferRootRow`,
// but `include()` does not yet adjust the return type to include relation fields.
// Until the ORM infers include results automatically, these types must be kept
// in sync with the actual ORM queries in server.ts by hand.
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
