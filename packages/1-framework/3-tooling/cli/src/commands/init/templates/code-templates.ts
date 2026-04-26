export type TargetId = 'postgres' | 'mongo';
export type AuthoringId = 'psl' | 'typescript';

export function targetPackageName(target: TargetId): string {
  return target === 'postgres' ? '@prisma-next/postgres' : '@prisma-next/mongo';
}

export function targetLabel(target: TargetId): string {
  return target === 'postgres' ? 'PostgreSQL' : 'MongoDB';
}

export function defaultSchemaPath(authoring: AuthoringId): string {
  if (authoring === 'typescript') {
    return 'prisma/contract.ts';
  }
  return 'prisma/contract.prisma';
}

export function starterSchema(target: TargetId, authoring: AuthoringId): string {
  if (authoring === 'typescript') {
    return target === 'mongo' ? starterSchemaTsMongo() : starterSchemaTsPostgres();
  }
  return target === 'mongo' ? starterSchemaPslMongo() : starterSchemaPslPostgres();
}

/**
 * Renders a short authoring-appropriate schema sample (FR5.1) for embedding
 * in `prisma-next.md`. Returns a complete fenced markdown code block.
 *
 * The sample intentionally shows just one model: it's illustrative, not
 * a substitute for the full scaffolded contract file. The TS samples use
 * the same outer shape as `starterSchemaTs*` (FR5.3) so a user reading
 * the doc and the file side-by-side sees the same structure.
 */
export function schemaSample(target: TargetId, authoring: AuthoringId): string {
  if (authoring === 'typescript') {
    return target === 'mongo' ? schemaSampleTsMongo() : schemaSampleTsPostgres();
  }
  return target === 'mongo' ? schemaSamplePslMongo() : schemaSamplePslPostgres();
}

function schemaSamplePslPostgres(): string {
  return `\`\`\`prisma
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}
\`\`\``;
}

function schemaSamplePslMongo(): string {
  return `\`\`\`prisma
model User {
  id    ObjectId @id @map("_id")
  email String   @unique
  name  String?
  @@map("users")
}
\`\`\``;
}

function schemaSampleTsPostgres(): string {
  return `\`\`\`typescript
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract(
  { family: sqlFamily, target: postgresPack },
  ({ field, model }) => ({
    models: {
      User: model('User', {
        fields: {
          id: field.id.uuidv7(),
          email: field.text().unique(),
          name: field.text().optional(),
        },
      }),
    },
  }),
);
\`\`\``;
}

function schemaSampleTsMongo(): string {
  return `\`\`\`typescript
import mongoFamily from '@prisma-next/family-mongo/pack';
import { defineContract } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTarget from '@prisma-next/target-mongo/pack';

export const contract = defineContract(
  { family: mongoFamily, target: mongoTarget },
  ({ field, model }) => ({
    models: {
      User: model('User', {
        collection: 'users',
        fields: {
          _id: field.objectId(),
          email: field.string(),
          name: field.string().optional(),
        },
      }),
    },
  }),
);
\`\`\``;
}

function starterSchemaPslPostgres(): string {
  return `model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime @default(now())
}
`;
}

function starterSchemaPslMongo(): string {
  return `model User {
  id    ObjectId @id @map("_id")
  email String   @unique
  name  String?
  posts Post[]
  @@map("users")
}

model Post {
  id       ObjectId @id @map("_id")
  title    String
  content  String?
  author   User     @relation(fields: [authorId], references: [id])
  authorId ObjectId
  @@map("posts")
}
`;
}

function starterSchemaTsPostgres(): string {
  return `import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract(
  { family: sqlFamily, target: postgresPack },
  ({ field, model, rel }) => ({
    models: {
      User: model('User', {
        fields: {
          id: field.id.uuidv7(),
          email: field.text().unique(),
          name: field.text().optional(),
          createdAt: field.createdAt(),
        },
        relations: {
          posts: rel.hasMany('Post', { by: 'authorId' }),
        },
      }),

      Post: model('Post', {
        fields: {
          id: field.id.uuidv7(),
          title: field.text(),
          content: field.text().optional(),
          authorId: field.uuid(),
          createdAt: field.createdAt(),
        },
        relations: {
          author: rel.belongsTo('User', { from: 'authorId', to: 'id' }),
        },
      }),
    },
  }),
);
`;
}

function starterSchemaTsMongo(): string {
  return `import mongoFamily from '@prisma-next/family-mongo/pack';
import { defineContract } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTarget from '@prisma-next/target-mongo/pack';

export const contract = defineContract(
  { family: mongoFamily, target: mongoTarget },
  ({ field, model, rel }) => ({
    models: {
      User: model('User', {
        collection: 'users',
        fields: {
          _id: field.objectId(),
          email: field.string(),
          name: field.string().optional(),
        },
        relations: {
          posts: rel.hasMany('Post', { from: '_id', to: 'authorId' }),
        },
      }),

      Post: model('Post', {
        collection: 'posts',
        fields: {
          _id: field.objectId(),
          title: field.string(),
          content: field.string().optional(),
          authorId: field.objectId(),
        },
        relations: {
          author: rel.belongsTo('User', { from: 'authorId', to: '_id' }),
        },
      }),
    },
  }),
);
`;
}

export function configFile(target: TargetId, contractPath: string): string {
  const pkg = targetPackageName(target);
  return `import 'dotenv/config';
import { defineConfig } from '${pkg}/config';

export default defineConfig({
  contract: ${JSON.stringify(contractPath)},
  db: {
    connection: process.env['DATABASE_URL']!,
  },
});
`;
}

export function dbFile(target: TargetId): string {
  if (target === 'postgres') {
    return `import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({ contractJson });
`;
  }

  return `import mongo from '@prisma-next/mongo/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = mongo<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});
`;
}
