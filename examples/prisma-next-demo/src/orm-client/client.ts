import { Collection, orm } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Contract } from '../prisma/contract.d';
import { db } from '../prisma/db';

const contract = db.context.contract as Contract;

class UserCollection extends Collection<Contract, 'User'> {
  admins() {
    return this.where({ kind: 'admin' });
  }

  byEmail(email: string) {
    return this.where({ email });
  }

  emailDomain(domain: string) {
    return this.where((user) => user.email.ilike(`%@${domain}`));
  }

  withPostTitle(titleTerm: string) {
    return this.where((user) => user.posts.some((post) => post.title.ilike(`%${titleTerm}%`)));
  }

  newestFirst() {
    return this.orderBy((user) => user.createdAt.desc());
  }
}

class PostCollection extends Collection<Contract, 'Post'> {
  forUser(userId: string) {
    return this.where({ userId });
  }

  withTitle(titleTerm: string) {
    return this.where((post) => post.title.ilike(`%${titleTerm}%`));
  }

  newestFirst() {
    return this.orderBy((post) => post.createdAt.desc());
  }
}

export function createOrmClient(runtime: Runtime) {
  return orm({
    contract,
    runtime,
    collections: {
      User: UserCollection,
      Post: PostCollection,
    },
  });
}
