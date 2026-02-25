import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import { createMockRuntime, createTestContract, type TestContract } from './helpers';

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

const contract = createTestContract();
const runtime = createMockRuntime();

const db = orm({
  contract,
  runtime,
  collections: { users: UserCollection, Post: PostCollection },
});

db.users.named('Alice');
db.user.named('Alice');
db.User.named('Alice');
db.posts.published();
db.post.published();
db.Post.published();

orm({
  contract,
  runtime,
  // @ts-expect-error collections values must be classes, not instances
  collections: { users: new UserCollection({ contract, runtime }, 'User') },
});
