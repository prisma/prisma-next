import { orm, Collection } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Contract } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' with { type: 'json' };

const contract = contractJson as unknown as Contract;

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

export function createOrmClient(runtime: Runtime) {
  return orm({
    contract,
    runtime,
    collections: {
      users: UserCollection,
      posts: PostCollection,
    },
  });
}
