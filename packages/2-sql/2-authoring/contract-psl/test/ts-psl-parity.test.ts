import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import type { AuthoringContributions } from '@prisma-next/framework-components/authoring';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { createBuiltinLikeControlMutationDefaults } from './fixtures';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sql/text@1',
          nativeType: 'text',
        },
      },
      createdAt: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sql/timestamp@1',
          nativeType: 'timestamp',
          default: {
            kind: 'function',
            expression: 'now()',
          },
        },
      },
    },
  },
} as const satisfies FamilyPackRef<'sql'>;

const portablePostgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    type: {
      enum: {
        kind: 'typeConstructor',
        args: [{ kind: 'string' }, { kind: 'stringArray' }],
        output: {
          codecId: 'pg/enum@1',
          nativeType: { kind: 'arg', index: 0 },
          typeParams: {
            values: { kind: 'arg', index: 1 },
          },
        },
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const pgvectorExtensionPack = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    type: {
      pgvector: {
        vector: {
          kind: 'typeConstructor',
          args: [{ kind: 'number', integer: true, minimum: 1, maximum: 2000 }],
          output: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: {
              length: { kind: 'arg', index: 0 },
            },
          },
        },
      },
    },
  },
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

const authoringContributions = {
  field: sqlFamilyPack.authoring.field,
  type: {
    ...portablePostgresTargetPack.authoring.type,
    ...pgvectorExtensionPack.authoring.type,
  },
} as const satisfies AuthoringContributions;

const scalarTypeDescriptors = new Map([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
  ['String', { codecId: 'sql/text@1', nativeType: 'text' }],
  ['DateTime', { codecId: 'sql/timestamp@1', nativeType: 'timestamp' }],
  ['Bytes', { codecId: 'pg/bytea@1', nativeType: 'bytea' }],
] as const);

const int4Column = {
  codecId: 'pg/int4@1',
  nativeType: 'int4',
} as const satisfies ColumnTypeDescriptor;

const representativePslSchema = `types {
  Embedding1536 = Bytes @pgvector.column(length: 1536)
}

enum Role {
  USER
  ADMIN
}

model User {
  id Int @id(map: "user_pkey")
  email String @unique(map: "user_email_key")
  role Role
  embedding Embedding1536?
  createdAt DateTime @default(now())
  posts Post[]
}

model Post {
  id Int @id(map: "post_pkey")
  authorId Int
  title String
  author User @relation(fields: [authorId], references: [id], map: "post_author_id_fkey", onDelete: Cascade)
  @@index([authorId], map: "post_author_id_idx")
}
`;

const representativeTsAuthoring = `defineContract(
  { family: sqlFamilyPack, target: portablePostgresTargetPack, extensionPacks: { pgvector: pgvectorExtensionPack } },
  ({ type, field, model, rel }) => {
    const types = {
      Role: type.enum('Role', ['USER', 'ADMIN'] as const),
      Embedding1536: type.pgvector.vector(1536),
    } as const;
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id({ name: 'user_pkey' }),
        email: field.text().unique({ name: 'user_email_key' }),
        role: field.namedType(types.Role),
        embedding: field.namedType(types.Embedding1536).optional(),
        createdAt: field.createdAt(),
      },
      relations: { posts: rel.hasMany(() => Post, { by: 'authorId' }) },
    }).sql({ table: 'user' });
    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id({ name: 'post_pkey' }),
        authorId: field.column(int4Column),
        title: field.text(),
      },
      relations: { author: rel.belongsTo(User, { from: 'authorId', to: 'id' }) },
    }).sql(({ cols, constraints }) => ({
      table: 'post',
      indexes: [constraints.index(cols.authorId, { name: 'post_author_id_idx' })],
      foreignKeys: [constraints.foreignKey(cols.authorId, User.refs.id, { name: 'post_author_id_fkey', onDelete: 'cascade' })],
    }));
    return { types, models: { User, Post } };
  },
)`;

function buildTsContract() {
  return defineContract(
    {
      family: sqlFamilyPack,
      target: portablePostgresTargetPack,
      extensionPacks: { pgvector: pgvectorExtensionPack },
    },
    ({ type, field, model, rel }) => {
      const types = {
        Role: type.enum('Role', ['USER', 'ADMIN'] as const),
        Embedding1536: type.pgvector.vector(1536),
      } as const;

      const UserBase = model('User', {
        fields: {
          id: field.column(int4Column).id({ name: 'user_pkey' }),
          email: field.text().unique({ name: 'user_email_key' }),
          role: field.namedType(types.Role),
          embedding: field.namedType(types.Embedding1536).optional(),
          createdAt: field.createdAt(),
        },
      });

      const Post = model('Post', {
        fields: {
          id: field.column(int4Column).id({ name: 'post_pkey' }),
          authorId: field.column(int4Column),
          title: field.text(),
        },
        relations: {
          author: rel.belongsTo(UserBase, { from: 'authorId', to: 'id' }),
        },
      }).sql(({ cols, constraints }) => ({
        table: 'post',
        indexes: [constraints.index(cols.authorId, { name: 'post_author_id_idx' })],
        foreignKeys: [
          constraints.foreignKey(cols.authorId, UserBase.refs.id, {
            name: 'post_author_id_fkey',
            onDelete: 'cascade',
          }),
        ],
      }));

      const User = UserBase.relations({
        posts: rel.hasMany(() => Post, { by: 'authorId' }),
      }).sql({
        table: 'user',
      });

      return {
        types,
        models: {
          User,
          Post,
        },
      };
    },
  );
}

function countSemanticLines(source: string): number {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//')).length;
}

describe('TS and PSL authoring parity', () => {
  it('lowers the same representative contract to identical output', () => {
    const tsContract = buildTsContract();
    const pslDocument = parsePslDocument({
      schema: representativePslSchema,
      sourceId: 'schema.prisma',
    });

    const interpreted = interpretPslDocumentToSqlContract({
      document: pslDocument,
      target: portablePostgresTargetPack,
      scalarTypeDescriptors,
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      authoringContributions,
      composedExtensionPacks: ['pgvector'],
      composedExtensionPackRefs: [pgvectorExtensionPack],
    });

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });

  it('keeps the staged contract DSL within the terseness threshold for the same contract', () => {
    const pslLines = countSemanticLines(representativePslSchema);
    const tsLines = countSemanticLines(representativeTsAuthoring);

    expect(tsLines).toBeLessThanOrEqual(Math.ceil(pslLines * 1.6));
  });
});
