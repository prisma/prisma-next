import { supabase } from '@prisma-next/extension-supabase';
import sqlFamily from '@prisma-next/family-sql/pack';
import {
  defineContract,
  rel,
} from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import type { Contract as SupabaseContract } from '../../migrations/supabase/contract.d';
import supabaseContractJson from '../../migrations/supabase/contract.json' with { type: 'json' };

// The typed handle to Supabase's `auth`/`storage`/... contract space.
// The handle is branded with spaceId='supabase' so the framework distinguishes
// cross-contract refs from local refs at lowering time.
const supabaseContract = supabase.contract<SupabaseContract>(supabaseContractJson);

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    namespaces: ['public'],
    extensionPacks: { supabase: supabase.pack() },
    capabilities: {
      postgres: {
        returning: true,
        'defaults.uuidv4': true,
        'defaults.now': true,
        // No capability flag for RLS — target presence is the gate.
        // The Postgres pack carries RLS support; pack-aware typing makes
        // `.rls(...)` visible on ContractModelBuilder only for Postgres.
        // (See design-holes #1.)
      },
    },
  },
  ({ field, model }) => {
    const Profile = model('Profile', {
      namespace: 'public',
      fields: {
        id: field.id.uuidv4(),
        userId: field.uuid(),
        username: field.text(),
        bio: field.text().optional(),
        createdAt: field.temporal.createdAt(),
        updatedAt: field.temporal.updatedAt(),
      },
    });

    const Post = model('Post', {
      namespace: 'public',
      fields: {
        id: field.id.uuidv4(),
        authorId: field.uuid(),
        title: field.text(),
        body: field.text(),
        publishedAt: field.temporal.timestamptz().optional(),
        createdAt: field.temporal.createdAt(),
      },
    });

    return {
      models: {
        // Profile: owns a cross-contract FK (to auth.User) and is guarded by RLS.
        Profile: Profile.relations({
          // Cross-contract: rel.belongsTo accepts a model handle from any
          // contract space registered in `extensionPacks`. The handle's brand
          // tells the framework this targets contract space 'supabase'.
          user: rel.belongsTo(supabaseContract.models.AuthUser, {
            from: 'userId',
            to: 'id',
          }),
          // Local within-namespace relation; resolves at lowering against
          // the same contract.
          posts: rel.hasMany(Post, { by: 'authorId' }),
        })
          // Target-agnostic model attributes — composite / named uniques live here,
          // following the existing DSL split between `.attributes()` and `.sql()`.
          .attributes(({ fields, constraints }) => ({
            uniques: [
              constraints.unique(fields.userId,   { name: 'profile_userId_unique' }),
              constraints.unique(fields.username, { name: 'profile_username_unique' }),
            ],
          }))
          // Target-specific SQL — table name, indexes, foreign keys.
          .sql(({ cols, constraints }) => ({
            table: 'profile',
            foreignKeys: [
              constraints.foreignKey(
                cols.userId,
                supabaseContract.models.AuthUser.refs.id,
                {
                  name: 'profile_userId_fkey',
                  // Cascade across the contract-space boundary is the developer's
                  // explicit opt-in. No diagnostic — see
                  // `.agents/rules/explicit-opt-in-over-diagnostics.mdc`.
                  onDelete: 'cascade',
                },
              ),
            ],
          }))
          // Postgres-only stage; only typed when the target carries RLS support.
          // Array of named policy descriptors — each carries its own name, operation,
          // roles, optional `as`, plus the predicate bodies. Multiple permissive
          // policies for the same operation are allowed (Postgres ORs them); the
          // PSL surface mirrors this with named-block policies.
          .rls([
            {
              name: 'profiles_select_anon_and_authed',
              operation: 'select',
              roles: [supabase.roles.anon, supabase.roles.authenticated],
              using: 'true',
            },
            // auth.uid() is declared in the Supabase contract as an externally-managed
            // function (see migrations/supabase/contract.json).
            {
              name: 'profiles_insert_own',
              operation: 'insert',
              roles: [supabase.roles.authenticated],
              withCheck: 'user_id = (auth.uid())::uuid',
            },
            {
              name: 'profiles_update_own',
              operation: 'update',
              roles: [supabase.roles.authenticated],
              using:     'user_id = (auth.uid())::uuid',
              withCheck: 'user_id = (auth.uid())::uuid',
            },
            {
              name: 'profiles_delete_own',
              operation: 'delete',
              roles: [supabase.roles.authenticated],
              using: 'user_id = (auth.uid())::uuid',
            },
          ]),

        // Post: local FK to Profile (within-namespace), RLS subqueries reference profile.
        Post: Post.relations({
          author: rel.belongsTo(Profile, { from: 'authorId', to: 'id' }),
        })
          .sql(({ cols, constraints }) => ({
            table: 'post',
            foreignKeys: [
              constraints.foreignKey(cols.authorId, Profile.refs.id, {
                name: 'post_authorId_fkey',
                onDelete: 'cascade',
              }),
            ],
          }))
          // `using`/`withCheck` accept `string | (ctx) => string`. The function
          // form exposes `ref(modelHandle)` which returns the canonical, quoted,
          // namespace-qualified table identifier — so renames in Profile.sql({ table })
          // or its namespace track automatically. Bare strings (no table reference)
          // stay one-liners. (See design-holes #5.)
          .rls([
            {
              name: 'posts_select_published',
              operation: 'select',
              roles: [supabase.roles.anon, supabase.roles.authenticated],
              using: 'published_at IS NOT NULL',
            },
            {
              name: 'posts_insert_own',
              operation: 'insert',
              roles: [supabase.roles.authenticated],
              withCheck: ({ ref }) =>
                `author_id IN (SELECT id FROM ${ref(Profile)} WHERE user_id = (auth.uid())::uuid)`,
            },
            {
              name: 'posts_update_own',
              operation: 'update',
              roles: [supabase.roles.authenticated],
              using: ({ ref }) =>
                `author_id IN (SELECT id FROM ${ref(Profile)} WHERE user_id = (auth.uid())::uuid)`,
              withCheck: ({ ref }) =>
                `author_id IN (SELECT id FROM ${ref(Profile)} WHERE user_id = (auth.uid())::uuid)`,
            },
            {
              name: 'posts_delete_own',
              operation: 'delete',
              roles: [supabase.roles.authenticated],
              using: ({ ref }) =>
                `author_id IN (SELECT id FROM ${ref(Profile)} WHERE user_id = (auth.uid())::uuid)`,
            },
          ]),
      },
    };
  },
);

export type Contract = typeof contract;
