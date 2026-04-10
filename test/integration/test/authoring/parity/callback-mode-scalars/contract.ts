import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract(
  { family: sqlFamily, target: postgresPack },
  ({ field, model }) => {
    const User = model('User', {
      fields: {
        id: field.int().defaultSql('autoincrement()').id(),
        email: field.text().unique(),
        age: field.int(),
        isActive: field.boolean().default(true),
        score: field.float().optional(),
        profile: field.json().optional(),
        createdAt: field.createdAt(),
      },
    }).sql({ table: 'user' });
    const Post = model('Post', {
      fields: {
        id: field.int().defaultSql('autoincrement()').id(),
        userId: field.int(),
        title: field.text(),
        rating: field.float().optional(),
      },
      relations: {
        user: rel
          .belongsTo(User, { from: 'userId', to: 'id' })
          .sql({ fk: { onDelete: 'cascade', onUpdate: 'cascade' } }),
      },
    }).sql({ table: 'post' });
    return { models: { User, Post } };
  },
);
