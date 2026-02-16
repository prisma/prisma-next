import { orm, Collection } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import { executionContext } from '../prisma/context';

type Contract = typeof executionContext.contract;

class UserCollection extends Collection<Contract, 'User'> {
  admins() {
    return this.where((user) => user.kind.eq('admin'));
  }

  byEmail(email: string) {
    return this.where((user) => user.email.eq(email));
  }
}

class PostCollection extends Collection<Contract, 'Post'> {
  forUser(userId: string) {
    return this.where((post) => post.userId.eq(userId));
  }
}

export function createRepositoryClient(runtime: Runtime) {
  const contract = executionContext.contract;
  return orm({
    contract,
    runtime,
    repositories: {
      users: new UserCollection({ contract, runtime }, 'User'),
      posts: new PostCollection({ contract, runtime }, 'Post'),
    },
  });
}
