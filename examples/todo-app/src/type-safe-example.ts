import { orm } from '@prisma/orm';
import { makeT } from '@prisma/sql';
import contract from '../.prisma/contract.json' assert { type: 'json' };
import { validateContract } from '@prisma/relational-ir';
import { Tables } from '../.prisma/types';

const ir = validateContract(contract);

const r = orm(ir);
const t = makeT<Tables>(ir);

// Example: Relation access
console.log('Relation handles:');
console.log('r.user.post:', r.user.post);
console.log('r.post.user:', r.post.user);

// Example: Basic query building
const basicQuery = r.from(t.user).select({ id: t.user.id, email: t.user.email }).build();
console.log('\nBasic query:', basicQuery);

// Example: Include 1:N relation (user -> posts)
const userWithPostsQuery = r
  .from(t.user)
  .select({ id: t.user.id, email: t.user.email })
  .include(
    r.user.post,
    (posts: any) =>
      posts
        .select({ id: t.post.id, title: t.post.title })
        .where(t.post.published.eq(true))
        .orderBy('createdAt', 'DESC')
        .limit(5),
    { asArray: true, alias: 'posts' },
  )
  .build();

console.log('\nUser with posts query:', userWithPostsQuery);

// Example: Include N:1 relation (post -> user)
const postWithUserQuery = r
  .from(t.post)
  .select({ id: t.post.id, title: t.post.title })
  .include(r.post.user, (user: any) => user.select({ id: t.user.id, email: t.user.email }), {
    alias: 'author',
  })
  .build();

console.log('\nPost with user query:', postWithUserQuery);
