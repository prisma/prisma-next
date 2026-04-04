import type { IncludeResultFields, InferRootRow } from '@prisma-next/mongo-orm';
import type { Contract } from './contract';

// include() does not yet adjust the ORM return type to include relation fields.
// Until it does, PostWithAuthor must be constructed manually.
export type PostWithAuthor = InferRootRow<Contract, 'Post'> &
  IncludeResultFields<Contract, 'Post', { author: true }>;

type Serialized<T> = T extends Date
  ? string
  : T extends ReadonlyArray<infer U>
    ? Serialized<U>[]
    : T extends Record<string, unknown>
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

export type ApiPost = Serialized<PostWithAuthor>;
export type ApiUser = Serialized<InferRootRow<Contract, 'User'>>;
