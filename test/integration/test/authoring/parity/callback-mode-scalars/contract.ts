import {
  boolColumn,
  float8Column,
  int4Column,
  jsonbColumn,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
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
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        email: field.column(textColumn).unique(),
        age: field.column(int4Column),
        isActive: field.column(boolColumn).default(true),
        score: field.column(float8Column).optional(),
        profile: field.column(jsonbColumn).optional(),
        embedding: field.namedType(types.Embedding).optional(),
        createdAt: field.column(timestamptzColumn).defaultSql('now()'),
      },
    }).sql({ table: 'user' });
    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        userId: field.column(int4Column),
        title: field.column(textColumn),
        rating: field.column(float8Column).optional(),
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
