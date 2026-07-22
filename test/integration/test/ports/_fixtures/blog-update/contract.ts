import {
  boolColumn,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

// Faithful translation of prisma/prisma functional suite `blog-update`
// (postgres matrix entry).
//
// Original PSL (postgres provider):
//   model User {
//     id          String    @id
//     email       String    @unique
//     name        String?
//     posts       Post[]
//     profile     Profile?
//     wakesUpAt   DateTime? @default(now())
//     lastLoginAt DateTime? @default(now())
//   }
//   model Profile {
//     id             String    @id
//     bio            String?
//     notrequired    String?
//     user           User      @relation(fields: [userId], references: [id])
//     userId         String    @unique
//     goesToBedAt    DateTime? @default(now())
//     goesToOfficeAt DateTime? @default(now())
//   }
//   model Post {
//     id             String    @id
//     createdAt      DateTime  @default(now())
//     updatedAt      DateTime  @updatedAt
//     published      Boolean
//     title          String
//     content        String?
//     optional       String?
//     authorId       String?   @map("author")
//     author         User?     @relation(fields: [authorId], references: [id])
//     lastReviewedAt  DateTime? @default(now())
//     lastPublishedAt DateTime? @default(now())
//   }
//
// Notes:
// - `updatedAt @updatedAt` → field.temporal.updatedAt() (requires callback form of defineContract)
// - `authorId @map("author")` → .column('author') on the authorId field
// - `createdAt @default(now())` → .defaultSql('now()') (makes field optional in create)
// - Nullable DateTime? with @default(now()) → .optional().defaultSql('now()')
// - Prisma does NOT snake_case: table "User", "Post", "Profile"

const UserBase = model('User', {
  fields: {
    id: field.column(textColumn).id(),
    email: field.column(textColumn).unique(),
    name: field.column(textColumn).optional(),
    wakesUpAt: field.column(timestamptzColumn).optional().defaultSql('now()'),
    lastLoginAt: field.column(timestamptzColumn).optional().defaultSql('now()'),
  },
}).sql({ table: 'User' });

const ProfileBase = model('Profile', {
  fields: {
    id: field.column(textColumn).id(),
    bio: field.column(textColumn).optional(),
    notrequired: field.column(textColumn).optional(),
    userId: field.column(textColumn).unique(),
    goesToBedAt: field.column(timestamptzColumn).optional().defaultSql('now()'),
    goesToOfficeAt: field.column(timestamptzColumn).optional().defaultSql('now()'),
  },
}).sql({ table: 'Profile' });

export const contract = defineContract({}, ({ field: f, model: m, rel: r }) => {
  const PostBase = m('Post', {
    fields: {
      id: field.column(textColumn).id(),
      createdAt: field.column(timestamptzColumn).defaultSql('now()'),
      updatedAt: f.temporal.updatedAt(),
      published: field.column(boolColumn),
      title: field.column(textColumn),
      content: field.column(textColumn).optional(),
      optional: field.column(textColumn).optional(),
      authorId: field.column(textColumn).optional().column('author'),
      lastReviewedAt: field.column(timestamptzColumn).optional().defaultSql('now()'),
      lastPublishedAt: field.column(timestamptzColumn).optional().defaultSql('now()'),
    },
  }).sql({ table: 'Post' });

  const Post = PostBase.relations({
    author: r.belongsTo(UserBase, { from: 'authorId', to: 'id' }).sql({ fk: {} }),
  });

  const Profile = ProfileBase.relations({
    user: r.belongsTo(UserBase, { from: 'userId', to: 'id' }).sql({ fk: {} }),
  });

  const User = UserBase.relations({
    posts: r.hasMany(() => Post, { by: 'authorId' }),
    profile: r.hasOne(() => Profile, { by: 'userId' }),
  });

  return {
    models: { User, Post, Profile },
  };
});
