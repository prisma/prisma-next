import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContract, type TestContract } from './helpers';

class UserCollection extends Collection<TestContract, 'User'> {
  named(name: string) {
    return this.where((user) => user.name.eq(name));
  }
}

class PostCollection extends Collection<TestContract, 'Post'> {
  published() {
    return this.where((post) => post.views.gte(100));
  }
}

const contract = getTestContract();
const runtime = createMockRuntime();

const db = orm({
  contract,
  runtime,
  collections: { User: UserCollection, Post: PostCollection },
});

db.User.named('Alice');
db.Post.published();

orm({
  contract,
  runtime,
  // @ts-expect-error collections values must be classes, not instances
  collections: { User: new UserCollection({ contract, runtime }, 'User') },
});
