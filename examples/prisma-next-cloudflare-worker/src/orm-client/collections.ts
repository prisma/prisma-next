import { Collection } from '@prisma-next/sql-orm-client';
import type { Contract } from '../prisma/contract.d';

export class UserCollection extends Collection<Contract, 'User'> {
  admins() {
    return this.where({ kind: 'admin' });
  }

  newestFirst() {
    return this.orderBy((user) => user.createdAt.desc());
  }
}

export class PostCollection extends Collection<Contract, 'Post'> {
  forUser(userId: string) {
    return this.where({ userId });
  }

  newestFirst() {
    return this.orderBy((post) => post.createdAt.desc());
  }
}

export class TaskCollection extends Collection<Contract, 'Task'> {
  bugs() {
    return this.variant('Bug');
  }

  features() {
    return this.variant('Feature');
  }
}
