import * as pg from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import pgvector from '@prisma-next/extension-pgvector/pack';
import sqlFamily from '@prisma-next/family-sql/pack';
import { extractCodecLookup } from '@prisma-next/framework-components/control';
import { autoincrement, defineContract, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const postgresCodecLookup = extractCodecLookup([postgresAdapter]);

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    extensionPacks: { pgvector },
    codecLookup: postgresCodecLookup,
  },
  ({ field, model, type }) => {
    const types = {
      Embedding: type.pgvector.Vector(1536),
    } as const;
    const User = model('User', {
      fields: {
        id: field.column(pg.int4Column).default(autoincrement()).id(),
        email: field.column(pg.textColumn).unique(),
        age: field.column(pg.int4Column),
        isActive: field.column(pg.boolColumn).default(true),
        score: field.column(pg.float8Column).optional(),
        profile: field.column(pg.jsonbColumn).optional(),
        embedding: field.namedType(types.Embedding).optional(),
        createdAt: field.column(pg.timestamptzColumn).defaultSql('now()'),
      },
    }).sql({ table: 'user' });
    const Post = model('Post', {
      fields: {
        id: field.column(pg.int4Column).default(autoincrement()).id(),
        userId: field.column(pg.int4Column),
        title: field.column(pg.textColumn),
        rating: field.column(pg.float8Column).optional(),
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
