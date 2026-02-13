import { orm, Repository } from '@prisma-next/sql-repositories';
import type { Runtime } from '@prisma-next/sql-runtime';
import { executionContext } from '../prisma/context';

type Contract = typeof executionContext.contract;

class UserRepository extends Repository<Contract, 'User'> {
  admins() {
    return this.where((user) => user.kind.eq('admin'));
  }

  byEmail(email: string) {
    return this.where((user) => user.email.eq(email));
  }
}

class PostRepository extends Repository<Contract, 'Post'> {
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
      users: new UserRepository({ contract, runtime }, 'User'),
      posts: new PostRepository({ contract, runtime }, 'Post'),
    },
  });
}
