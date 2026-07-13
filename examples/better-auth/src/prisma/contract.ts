import { textColumn } from '@prisma-next/adapter-postgres/column-types';
import { User } from '@prisma-next/extension-better-auth/contract';
import betterAuthPack from '@prisma-next/extension-better-auth/pack';
import { defineContract, field, model, rel } from '@prisma-next/postgres/contract-builder';

/**
 * The app's own model. `userId` references the better-auth space's `User`
 * through the branded handle: `rel.belongsTo(User, …)` gives the ORM a
 * navigable `profile.user` relation, and the `constraints.foreignKey`
 * lowers to a real cross-space FK onto `"public"."user"(id)` — created by
 * `db init` alongside the pack's own tables.
 */
const Profile = model('Profile', {
  fields: {
    id: field.column(textColumn).id(),
    bio: field.column(textColumn),
    userId: field.column(textColumn).unique(),
  },
  relations: {
    user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
  },
}).sql(({ cols, constraints }) => ({
  table: 'profile',
  foreignKeys: [constraints.foreignKey(cols.userId, User.refs.id, { onDelete: 'cascade' })],
}));

export const contract = defineContract({
  extensionPacks: { 'better-auth': betterAuthPack },
  models: { Profile },
});
