import type { IncludeResultFields, InferFullRow, InferRootRow } from '@prisma-next/mongo-orm';
import type { Contract } from './contract';

export type TaskRow = InferRootRow<Contract, 'Task'>;
export type UserRow = InferRootRow<Contract, 'User'>;
export type CommentRow = InferFullRow<Contract, 'Comment'>;
export type AddressRow = InferFullRow<Contract, 'Address'>;

export type TaskWithAssignee = TaskRow & IncludeResultFields<Contract, 'Task', { assignee: true }>;

type Serialized<T> = T extends Date
  ? string
  : T extends ReadonlyArray<infer U>
    ? Serialized<U>[]
    : T extends Record<string, unknown>
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

export type ApiTask = Serialized<TaskWithAssignee>;
export type ApiUser = Serialized<UserRow>;
