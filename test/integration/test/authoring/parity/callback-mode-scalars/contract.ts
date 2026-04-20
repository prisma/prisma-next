import pgvector from '@prisma-next/extension-pgvector/pack';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract(
  { family: sqlFamily, target: postgresPack, extensionPacks: { pgvector } },
  ({ field, model, type }) => {
    const types = {
      Embedding: type.pgvector.Vector(1536),
    } as const;
    const User = model('User', {
      fields: {
        id: field.int().defaultSql('autoincrement()').id(),
        email: field.text().unique(),
        age: field.int(),
        isActive: field.boolean().default(true),
        score: field.float().optional(),
        profile: field.json().optional(),
        embedding: field.namedType(types.Embedding).optional(),
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
    return { types, models: { User, Post } };
  },
);
