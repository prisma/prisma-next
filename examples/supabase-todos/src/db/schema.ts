import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

/**
 * Contract for the supabase-todos PoC.
 *
 * Three tables:
 *   - profiles         — one row per Supabase Auth user; `id` matches
 *                        `auth.users.id`. Owned by the authenticated
 *                        user via RLS.
 *   - todos            — per-user todo items, isolated by RLS via
 *                        `user_id = auth.uid()`.
 *   - public_messages  — public board; `anon` can read, `authenticated`
 *                        can read and insert their own.
 *
 * RLS policies, role grants, and the cross-schema FKs to `auth.users`
 * are NOT expressed here. Prisma Next's contract DSL has no surface
 * for either today — see `projects/supabase-poc/framework-limitations.md`
 * FL-01 (no contract-level RLS metadata) and FL-02 (no cross-schema FK
 * in the contract DSL). Both are authored in the PN migration file
 * (T1.6) instead, using the in-example `enableRowLevelSecurity` /
 * `createRlsPolicy` factories (T1.5) for RLS and raw SQL for the
 * `auth.users` FKs.
 */
export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    capabilities: {
      postgres: {
        lateral: true,
        jsonAgg: true,
        returning: true,
        'defaults.now': true,
        'defaults.uuidv4': true,
      },
    },
  },
  ({ field, model }) => {
    const Profile = model('Profile', {
      fields: {
        // Matches `auth.users.id`; the seed script and any
        // user-creation path is responsible for keeping it in sync.
        // Intentionally no default: a default-uuidv4 here would
        // diverge from the auth-user identifier.
        id: field.uuid().id(),
        email: field.text(),
        displayName: field.text().optional(),
        createdAt: field.createdAt(),
      },
    });

    const Todo = model('Todo', {
      fields: {
        id: field.id.uuidv4(),
        userId: field.uuid(),
        title: field.text(),
        completed: field.boolean(),
        createdAt: field.createdAt(),
      },
    });

    const PublicMessage = model('PublicMessage', {
      fields: {
        id: field.id.uuidv4(),
        authorId: field.uuid(),
        body: field.text(),
        createdAt: field.createdAt(),
      },
    });

    return {
      models: {
        Profile: Profile.sql({ table: 'profiles' }),
        Todo: Todo.sql({ table: 'todos' }),
        PublicMessage: PublicMessage.sql({ table: 'public_messages' }),
      },
    };
  },
);
