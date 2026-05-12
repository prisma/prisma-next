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
        // RLS capability — gates rlsPolicy(...) authoring and the planner's
        // CREATE POLICY emission.
        // DESIGN HOLE #1: `'postgres.rls'` vs `'supabase.rls'`. Lean target-level.
        'postgres.rls': true,
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
        // Profile: owns a cross-contract FK (to auth.User) and is queried with RLS.
        Profile: Profile.relations({
          // Cross-contract: rel.belongsTo accepts a model handle from any
          // contract space registered in `extensionPacks`. The handle's brand
          // tells the framework this targets contract space 'supabase'.
          user: rel.belongsTo(supabaseContract.models.AuthUser, {
            from: 'userId',
            to: 'id',
          }),
          // Local within-namespace relation. Resolves at lowering against
          // the same contract.
          posts: rel.hasMany(Post, { by: 'authorId' }),
        }).sql(({ cols, constraints, rlsPolicy }) => ({
          table: 'profile',
          foreignKeys: [
            constraints.foreignKey(
              cols.userId,
              supabaseContract.models.AuthUser.refs.id,
              {
                name: 'profile_userId_fkey',
                // DESIGN HOLE #3: onDelete on cross-contract FKs. See `cross-contract-refs.md`
                // open question on cascading actions across spaces.
                onDelete: 'cascade',
              },
            ),
          ],
          // DESIGN HOLE #4: uniqueConstraints inside .sql() block. Existing demo
          // example didn't use this shape — verify against the DSL.
          uniqueConstraints: [
            constraints.unique([cols.userId], {
              name: 'profile_userId_unique',
            }),
            constraints.unique([cols.username], {
              name: 'profile_username_unique',
            }),
          ],
          // DESIGN HOLE #2: rlsPolicy injection point. The example assumes
          // rlsPolicy is destructured from the .sql() closure alongside cols,
          // constraints. `rls.md` shows `c.rlsPolicy({...})` — alignment TBD.
          rlsPolicies: [
            // Public read: any role can see profile rows (subject to its own grants).
            // Modeled after Supabase's typical "public profile" pattern.
            rlsPolicy({
              name: 'profiles_select_anon_and_authed',
              command: 'select',
              roles: [supabase.roles.anon, supabase.roles.authenticated],
              using: 'true',
            }),
            // Authenticated users may insert / update / delete only their own profile.
            // auth.uid() is declared in the Supabase contract as an externally-managed
            // function (see migrations/supabase/contract.json).
            rlsPolicy({
              name: 'profiles_insert_own',
              command: 'insert',
              roles: [supabase.roles.authenticated],
              check: 'user_id = (auth.uid())::uuid',
            }),
            rlsPolicy({
              name: 'profiles_update_own',
              command: 'update',
              roles: [supabase.roles.authenticated],
              using: 'user_id = (auth.uid())::uuid',
              check: 'user_id = (auth.uid())::uuid',
            }),
            rlsPolicy({
              name: 'profiles_delete_own',
              command: 'delete',
              roles: [supabase.roles.authenticated],
              using: 'user_id = (auth.uid())::uuid',
            }),
          ],
        })),

        // Post: local FK to Profile (within-namespace), RLS subqueries reference profile.
        Post: Post.relations({
          author: rel.belongsTo(Profile, { from: 'authorId', to: 'id' }),
        }).sql(({ cols, constraints, rlsPolicy }) => ({
          table: 'post',
          foreignKeys: [
            constraints.foreignKey(cols.authorId, Profile.refs.id, {
              name: 'post_authorId_fkey',
              onDelete: 'cascade',
            }),
          ],
          rlsPolicies: [
            // Anyone (incl. anon) can read published posts.
            rlsPolicy({
              name: 'posts_select_published',
              command: 'select',
              roles: [supabase.roles.anon, supabase.roles.authenticated],
              using: 'published_at IS NOT NULL',
            }),
            // Authenticated users can additionally see their own drafts.
            // DESIGN HOLE #5: predicate references the `public.profile` table.
            // Should the framework canonicalize this qualifier, or are users
            // responsible for matching their own contract's namespace layout?
            rlsPolicy({
              name: 'posts_select_own_drafts',
              command: 'select',
              roles: [supabase.roles.authenticated],
              using:
                'author_id IN (SELECT id FROM public.profile WHERE user_id = (auth.uid())::uuid)',
            }),
            rlsPolicy({
              name: 'posts_insert_own',
              command: 'insert',
              roles: [supabase.roles.authenticated],
              check:
                'author_id IN (SELECT id FROM public.profile WHERE user_id = (auth.uid())::uuid)',
            }),
          ],
        })),
      },
    };
  },
);

export type Contract = typeof contract;
