import { sql, makeT } from '@prisma/sql';
import { orm } from '@prisma/orm';
import { runtime } from '../prisma/db';
import contract from '../../.prisma/contract.json';
import { parseIR, validateContract } from '@prisma/relational-ir';
import * as Contract from '../../.prisma/contract';

const ir = validateContract(contract);

// Extract the contract types from the namespace
type ContractTypes = {
  Tables: Record<string, Record<string, any>>;
  Relations: Contract.Contract.Relations;
  Uniques: Contract.Contract.Uniques;
};

// Parameterized ORM factory (just like makeT) - using extracted contract types
const r = orm<ContractTypes>(ir);
const t = makeT<Contract.Contract.Tables>(ir);

// ============================================================================
// BASIC QUERIES (using base SQL DSL)
// ============================================================================

export async function getActiveUsers() {
  const query = sql(parseIR(contract))
    .from(t.user)
    .where(t.user.active.eq(true))
    .select({ id: t.user.id, email: t.user.email });

  // Use runtime.execute() instead of db.execute() to get lint checking
  return await runtime.execute(query.build());
}

export async function getUserById(id: number) {
  const query = sql(parseIR(contract)).from(t.user).where(t.user.id.eq(id)).select({
    id: t.user.id,
    email: t.user.email,
    active: t.user.active,
    createdAt: t.user.createdAt,
  });

  const results = await runtime.execute(query.build());
  return results[0] || null;
}

export async function getUsersByEmail(email: string) {
  const query = sql(parseIR(contract))
    .from(t.user)
    .where(t.user.email.eq(email))
    .select({ id: t.user.id, email: t.user.email, active: t.user.active });

  return await runtime.execute(query.build());
}

// Example of a query that would trigger lint warnings
export async function getAllUsers() {
  const query = sql(parseIR(contract)).from(t.user).select({ id: t.user.id, email: t.user.email });
  // This will trigger 'no-missing-limit' warning since there's no WHERE or LIMIT

  return await runtime.execute(query.build());
}

// ============================================================================
// RELATIONSHIP QUERIES (using ORM DSL)
// ============================================================================

export async function getUsersWithPosts() {
  const query = r
    .from(t.user)
    .select({ id: t.user.id, email: t.user.email })
    .include(
      r.user.post,
      (posts) => {
        return posts
          .select({ id: t.post.id, title: t.post.title })
          .where(t.post.published.eq(true))
          .orderBy('createdAt', 'DESC')
          .limit(5);
      },
      { asArray: true, alias: 'posts' },
    )
    .build();

  console.log('Users with posts query SQL:', query.sql);
  console.log('Users with posts query params:', query.params);

  return await runtime.execute(query);
}

export async function getPostsWithAuthors() {
  const query = r
    .from(t.post)
    .select({ id: t.post.id, title: t.post.title })
    .include(
      r.post.user,
      (user) => {
        return user.select({ id: t.user.id, email: t.user.email });
      },
      { alias: 'author' },
    )
    .build();

  console.log('Posts with authors query SQL:', query.sql);
  console.log('Posts with authors query params:', query.params);

  return await runtime.execute(query);
}

export async function getPublishedPostsWithAuthors() {
  const query = r
    .from(t.post)
    .where(t.post.published.eq(true))
    .select({ id: t.post.id, title: t.post.title, createdAt: t.post.createdAt })
    .include(
      r.post.user,
      (user) => {
        return user.select({ id: t.user.id, email: t.user.email });
      },
      { alias: 'author' },
    )
    .orderBy('createdAt', 'DESC')
    .limit(10)
    .build();

  console.log('Published posts with authors query SQL:', query.sql);
  console.log('Published posts with authors query params:', query.params);

  return await runtime.execute(query);
}
