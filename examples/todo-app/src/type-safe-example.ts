import { orm } from '@prisma/orm';
import { makeT } from '@prisma/sql';
import contract from '../.prisma/contract.json' assert { type: 'json' };
import { validateContract } from '@prisma/relational-ir';
import { Tables } from '../.prisma/types';
import { Contract } from '../.prisma/relations';

const ir = validateContract(contract);

// Extract the contract types from the namespace
type ContractTypes = {
  Tables: Contract.Tables;
  Relations: Contract.Relations;
  Uniques: Contract.Uniques;
};

// Parameterized ORM factory (just like makeT) - using extracted contract types
const r = orm<ContractTypes>(ir);
const t = makeT<Tables>(ir);

// Example 1: Type-safe relation handles
console.log('=== Type-Safe Relation Handles ===');
console.log('r.user.post:', r.user.post);
console.log('r.post.user:', r.post.user);

// Example 2: Type-safe relation builder in include callback
console.log('\n=== Type-Safe Include Callbacks ===');

// The 'posts' parameter is now properly typed as TypedRelationBuilder<'post'>
const userWithPostsQuery = r
  .from(t.user)
  .select({ id: t.user.id, email: t.user.email })
  .include(
    r.user.post,
    (posts) => {
      // 'posts' is properly typed - no more 'any'!
      // It has the same methods as the main builder but scoped to the post table
      return posts
        .select({ id: t.post.id, title: t.post.title })
        .where(t.post.published.eq(true))
        .orderBy('createdAt', 'DESC')
        .limit(5);
    },
    { asArray: true, alias: 'posts' },
  )
  .build();

console.log('User with posts query SQL:', userWithPostsQuery.sql);
console.log('User with posts query params:', userWithPostsQuery.params);

// Example 3: Type-safe N:1 relation
const postWithUserQuery = r
  .from(t.post)
  .select({ id: t.post.id, title: t.post.title })
  .include(
    r.post.user,
    (user) => {
      // 'user' is properly typed as TypedRelationBuilder<'user'>
      return user.select({ id: t.user.id, email: t.user.email });
    },
    { alias: 'author' },
  )
  .build();

console.log('\nPost with user query SQL:', postWithUserQuery.sql);
console.log('Post with user query params:', postWithUserQuery.params);

// Example 4: Result type inference (conceptual - TypeScript would infer these types)
console.log('\n=== Result Type Inference ===');
console.log('User with posts result type:');
console.log('{');
console.log('  id: number,');
console.log('  email: string,');
console.log('  posts: Array<{ id: number, title: string }>');
console.log('}');

console.log('\nPost with user result type:');
console.log('{');
console.log('  id: number,');
console.log('  title: string,');
console.log('  author__id: number,');
console.log('  author__email: string');
console.log('}');

// Example 5: Cardinality-based method restrictions
console.log('\n=== Cardinality-Based Restrictions ===');

// For 1:N relations, asArray is meaningful
const oneToManyQuery = r
  .from(t.user)
  .select({ id: t.user.id })
  .include(
    r.user.post,
    (posts) => posts.select({ id: t.post.id }),
    { asArray: true }, // Allowed for 1:N
  )
  .build();

console.log('1:N query (asArray: true):', oneToManyQuery.sql.includes('json_agg'));

// For N:1 relations, asArray is ignored (always flat)
const manyToOneQuery = r
  .from(t.post)
  .select({ id: t.post.id })
  .include(
    r.post.user,
    (user) => user.select({ id: t.user.id }),
    { asArray: true }, // Ignored for N:1
  )
  .build();

console.log('N:1 query (asArray ignored):', manyToOneQuery.sql.includes('LEFT JOIN'));
console.log('N:1 query (no json_agg):', !manyToOneQuery.sql.includes('json_agg'));
