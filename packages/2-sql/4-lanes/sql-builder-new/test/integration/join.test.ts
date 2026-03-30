import { describe, expect, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: JOIN', () => {
  const { db } = setupIntegrationTest();

  it('INNER JOIN returns matched rows', async () => {
    const rows = await collect(
      db()
        .users.innerJoin(db().posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
        .select('name', 'title')
        .all(),
    );
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row).toHaveProperty('name');
      expect(row).toHaveProperty('title');
    }
  });

  it('LEFT JOIN returns all left rows with nulls for unmatched', async () => {
    const rows = await collect(
      db()
        .users.outerLeftJoin(db().profiles, (f, fns) => fns.eq(f.users.id, f.profiles.user_id))
        .select('name', 'bio')
        .orderBy('name')
        .all(),
    );
    expect(rows).toHaveLength(4);
    const charlie = rows.find((r) => r.name === 'Charlie');
    expect(charlie!.bio).toBeNull();
    const alice = rows.find((r) => r.name === 'Alice');
    expect(alice!.bio).toBe('Alice bio');
  });

  it('self-join via .as()', async () => {
    const d = db();
    const rows = await collect(
      d.users
        .as('invitee')
        .innerJoin(d.users.as('inviter'), (f, fns) => fns.eq(f.invitee.invited_by_id, f.inviter.id))
        .select((f) => ({ invitee: f.invitee.name, inviter: f.inviter.name }))
        .all(),
    );
    expect(rows.length).toBeGreaterThan(0);
    const bob = rows.find((r) => r.invitee === 'Bob');
    expect(bob!.inviter).toBe('Alice');
  });

  it('subquery as join source', async () => {
    const d = db();
    const sub = d.posts.select('user_id', 'title').as('sub');
    const rows = await collect(
      d.users
        .innerJoin(sub, (f, fns) => fns.eq(f.users.id, f.sub.user_id))
        .select('name', 'title')
        .all(),
    );
    expect(rows.length).toBe(4);
    expect(rows[0]).toHaveProperty('name');
    expect(rows[0]).toHaveProperty('title');
  });
});
