/**
 * Seed script for the supabase-todos PoC.
 *
 * Idempotency (NOT convergence)
 * -----------------------------
 * The seed is **idempotent** but **not convergent**. Each fixture has a
 * deterministic primary key (auth-user id is owned by Supabase Auth; todo
 * / message ids are derived from a stable UUIDv5 of their fixture label),
 * and inserts use `upsert(..., { onConflict: 'id', ignoreDuplicates: true })`
 * so a second run does not create duplicate rows. **However**, because
 * the upsert is `ignoreDuplicates: true`, a row that has been mutated
 * out-of-band (e.g. by a test that didn't clean up its writes) will *not*
 * be repaired by re-running the seed — the existing-id branch is a no-op,
 * so the drifted column values stay drifted.
 *
 * The supported recovery path for a drifted DB is `supabase db reset`
 * from `examples/supabase-todos/`, then `pnpm migrate:up && pnpm seed`
 * to repopulate from a clean baseline. Test suites that mutate seed
 * rows (rather than transient per-test rows) are the usual culprit;
 * write-heavy tests should create / mutate / delete transient rows
 * inside `try/finally` blocks instead.
 *
 * (Profiles use `ignoreDuplicates: false`, so display-name / email
 * changes *are* convergent for that table only — kept that way so a
 * future fixture rename flows through naturally.)
 *
 * What it creates
 * ---------------
 *   alice@example.test (password: password-alice)  — owns 3 todos
 *   bob@example.test   (password: password-bob)    — owns 2 todos
 *   1 public message per user.
 *
 * Why supabase-js, not the PN admin runtime
 * -----------------------------------------
 * T1.7 stays separable from T1.8 (admin PN runtime in `src/server/db.ts`).
 * The admin client + PostgREST goes through the service-role JWT, which
 * bypasses RLS naturally — same end result for seeding without prejudging
 * the runtime composition T1.8 will land. The seed script also doubles
 * as a worked example of the `service-role-via-supabase-js` pattern.
 *
 * Environment
 * -----------
 *   SUPABASE_URL                 (default http://127.0.0.1:54321)
 *   SUPABASE_SERVICE_ROLE_KEY    (required; from `supabase status`)
 *
 * Reset workflow
 * --------------
 * `supabase db reset` rebuilds the local stack from scratch (also wipes
 * data — acceptable for PoC dev). After a reset, run `pnpm migrate:up`
 * then `pnpm seed` to repopulate.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const DATABASE_URL = process.env['DATABASE_URL'];

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is required (run `supabase status` to find the local key).',
  );
}
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required (the direct Postgres URL — see .env.example). ' +
      'Used by ensureRealtimePublication() to ALTER PUBLICATION supabase_realtime.',
  );
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface FixtureUser {
  readonly label: string;
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

const USERS: ReadonlyArray<FixtureUser> = [
  {
    label: 'alice',
    email: 'alice@example.test',
    password: 'password-alice',
    displayName: 'Alice Example',
  },
  {
    label: 'bob',
    email: 'bob@example.test',
    password: 'password-bob',
    displayName: 'Bob Example',
  },
];

interface TodoFixture {
  readonly ownerLabel: string;
  readonly key: string;
  readonly title: string;
  readonly completed: boolean;
}

const TODOS: ReadonlyArray<TodoFixture> = [
  { ownerLabel: 'alice', key: 'alice-1', title: 'Write the spec', completed: true },
  { ownerLabel: 'alice', key: 'alice-2', title: 'Review the plan', completed: false },
  { ownerLabel: 'alice', key: 'alice-3', title: 'Ship the PoC', completed: false },
  { ownerLabel: 'bob', key: 'bob-1', title: 'Read the spec', completed: false },
  { ownerLabel: 'bob', key: 'bob-2', title: 'Test RLS', completed: false },
];

interface MessageFixture {
  readonly authorLabel: string;
  readonly key: string;
  readonly body: string;
}

const MESSAGES: ReadonlyArray<MessageFixture> = [
  { authorLabel: 'alice', key: 'alice-msg-1', body: 'Hello world from Alice' },
  { authorLabel: 'bob', key: 'bob-msg-1', body: 'Bob says hi' },
];

/**
 * Derive a stable UUID-shaped string from a fixture key. Pseudo-UUIDv5
 * (we don't need the formal namespace machinery — only deterministic
 * output that survives re-runs). Variant bits set so PostgreSQL's
 * `uuid` type would also accept it; harmless for `char(36)`.
 */
function deterministicUuid(key: string): string {
  const hex = createHash('sha1').update(`supabase-todos:${key}`).digest('hex');
  const part1 = hex.slice(0, 8);
  const part2 = hex.slice(8, 12);
  const part3 = `5${hex.slice(13, 16)}`;
  const variantNibble = (Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8;
  const part4 = `${variantNibble.toString(16)}${hex.slice(17, 20)}`;
  const part5 = hex.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

async function ensureUser(fixture: FixtureUser): Promise<string> {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: fixture.email,
    password: fixture.password,
    email_confirm: true,
  });

  if (created?.user) {
    console.log(`created user ${fixture.email} (${created.user.id})`);
    return created.user.id;
  }

  // `createUser` returns an error like "A user with this email address has
  // already been registered" on re-runs. Find the existing user instead.
  if (
    createErr &&
    !/already.*registered|already exists|email_exists|email_address_already_in_use/i.test(
      createErr.message ?? '',
    )
  ) {
    throw createErr;
  }

  // Page through up to a few hundred users; PoC scale.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw listErr;
  const found = list?.users.find((u) => u.email === fixture.email);
  if (!found) {
    throw new Error(`user ${fixture.email} reportedly exists but was not found in listUsers`);
  }
  console.log(`found existing user ${fixture.email} (${found.id})`);
  return found.id;
}

async function upsertProfile(userId: string, fixture: FixtureUser): Promise<void> {
  const { error } = await admin
    .from('profiles')
    .upsert(
      { id: userId, email: fixture.email, display_name: fixture.displayName },
      { onConflict: 'id', ignoreDuplicates: false },
    );
  if (error) throw error;
}

async function upsertTodo(userId: string, fixture: TodoFixture): Promise<void> {
  const id = deterministicUuid(`todo:${fixture.key}`);
  const { error } = await admin
    .from('todos')
    .upsert(
      { id, user_id: userId, title: fixture.title, completed: fixture.completed },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

async function upsertMessage(userId: string, fixture: MessageFixture): Promise<void> {
  const id = deterministicUuid(`message:${fixture.key}`);
  const { error } = await admin
    .from('public_messages')
    .upsert(
      { id, author_id: userId, body: fixture.body },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

/**
 * Add `public.todos` to the `supabase_realtime` publication so the
 * Vite SPA's `postgres_changes` channel (T4.11) receives INSERT /
 * UPDATE / DELETE events for the user's todos.
 *
 * Why here, not in a PN migration:
 *  - PN's contract IR doesn't model logical-replication publications
 *    (FL-20). The contract only describes app schema; publication
 *    membership is a Supabase-runtime concern. Authoring it as a PN
 *    migration step would require a `rawSql`-style escape hatch on
 *    the migration ops surface, which the IR explicitly avoids.
 *  - The seed script is already the bootstrap step — it runs once
 *    after `supabase start && pnpm migrate:up`, owns the direct DB
 *    URL, and is the canonical place for "demo wiring that lives
 *    outside the contract."
 *  - It's cheap to make idempotent: check `pg_publication_tables`
 *    first, only `ALTER PUBLICATION ADD TABLE` when the table isn't
 *    already a member.
 *
 * `public_messages` does not need to be in the publication — the SPA
 * does not subscribe to it (the public board reads via REST), and
 * adding it would only create extra logical-replication traffic.
 */
async function ensureRealtimePublication(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const { rows } = await pool.query(
      "SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'todos'",
    );
    if (rows.length > 0) {
      console.log('realtime publication: public.todos already a member, no change');
      return;
    }
    await pool.query('ALTER PUBLICATION supabase_realtime ADD TABLE public.todos');
    console.log('realtime publication: added public.todos to supabase_realtime');
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const userIdsByLabel = new Map<string, string>();

  for (const user of USERS) {
    const id = await ensureUser(user);
    userIdsByLabel.set(user.label, id);
    await upsertProfile(id, user);
  }

  for (const todo of TODOS) {
    const userId = userIdsByLabel.get(todo.ownerLabel);
    if (!userId) throw new Error(`no user id for ${todo.ownerLabel}`);
    await upsertTodo(userId, todo);
  }

  for (const message of MESSAGES) {
    const userId = userIdsByLabel.get(message.authorLabel);
    if (!userId) throw new Error(`no user id for ${message.authorLabel}`);
    await upsertMessage(userId, message);
  }

  await ensureRealtimePublication();

  console.log('seed complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
