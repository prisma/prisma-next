import type { AuthoringContributions } from '@prisma-next/framework-components/authoring';
import type { ColumnTypeDescriptor } from '@prisma-next/framework-components/codec';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { type ForeignKey, namespaceTables, type SqlStorage } from '@prisma-next/sql-contract/types';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import { countSemanticLines } from '@prisma-next/test-utils/semantic-lines';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { createBuiltinLikeControlMutationDefaults, testEnumEntityContributions } from './fixtures';

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
      temporal: {
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
  },
} as const satisfies FamilyPackRef<'sql'>;

const portablePostgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: {
    entityTypes: testEnumEntityContributions,
    type: {},
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
        Vector: {
          kind: 'typeConstructor',
          args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 2000 }],
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
  entityTypes: portablePostgresTargetPack.authoring.entityTypes,
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

const bareSqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const sqliteTimestampTargetPack = {
  kind: 'target',
  id: 'sqlite',
  familyId: 'sql',
  targetId: 'sqlite',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  authoring: {
    field: {
      int: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sqlite/integer@1',
          nativeType: 'integer',
        },
      },
      text: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sqlite/text@1',
          nativeType: 'text',
        },
      },
      temporal: {
        createdAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sqlite/datetime@1',
            nativeType: 'text',
            default: {
              kind: 'function',
              expression: 'now()',
            },
          },
        },
        updatedAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sqlite/datetime@1',
            nativeType: 'text',
            executionDefaults: {
              onCreate: { kind: 'generator', id: 'timestampNow' },
              onUpdate: { kind: 'generator', id: 'timestampNow' },
            },
          },
        },
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'sqlite'>;

const postgresTimestampTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: {
    field: {
      int: {
        kind: 'fieldPreset',
        output: {
          codecId: 'pg/int4@1',
          nativeType: 'int4',
        },
      },
      text: {
        kind: 'fieldPreset',
        output: {
          codecId: 'pg/text@1',
          nativeType: 'text',
        },
      },
      temporal: {
        createdAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'pg/timestamptz@1',
            nativeType: 'timestamptz',
            default: {
              kind: 'function',
              expression: 'now()',
            },
          },
        },
        updatedAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'pg/timestamptz@1',
            nativeType: 'timestamptz',
            executionDefaults: {
              onCreate: { kind: 'generator', id: 'timestampNow' },
              onUpdate: { kind: 'generator', id: 'timestampNow' },
            },
          },
        },
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const postgresTimestampScalarTypeDescriptors = new Map([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['DateTime', { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' }],
  ['Json', { codecId: 'pg/jsonb@1', nativeType: 'jsonb' }],
] as const);

const postgresTimestampAuthoringContributions = {
  field: postgresTimestampTargetPack.authoring.field,
} as const satisfies AuthoringContributions;

const sqliteTimestampScalarTypeDescriptors = new Map([
  ['Int', { codecId: 'sqlite/integer@1', nativeType: 'integer' }],
  ['String', { codecId: 'sqlite/text@1', nativeType: 'text' }],
  ['DateTime', { codecId: 'sqlite/datetime@1', nativeType: 'text' }],
  ['Json', { codecId: 'sqlite/json@1', nativeType: 'text' }],
] as const);

const sqliteTimestampAuthoringContributions = {
  field: sqliteTimestampTargetPack.authoring.field,
} as const satisfies AuthoringContributions;

const representativePslSchema = `types {
  Embedding1536 = pgvector.Vector(1536)
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
  ({ enum: enumEntity, type, field, model, rel }) => {
    const types = {
      Role: enumEntity({ name: 'Role', values: ['USER', 'ADMIN'] as const }),
      Embedding1536: type.pgvector.Vector(1536),
    } as const;
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id({ name: 'user_pkey' }),
        email: field.text().unique({ name: 'user_email_key' }),
        role: field.namedType(types.Role),
        embedding: field.namedType(types.Embedding1536).optional(),
        createdAt: field.temporal.createdAt(),
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
      indexes: [constraints.index([cols.authorId], { name: 'post_author_id_idx' })],
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
    ({ enum: enumEntity, type, field, model, rel }) => {
      const types = {
        Role: enumEntity({ name: 'Role', values: ['USER', 'ADMIN'] as const }),
        Embedding1536: type.pgvector.Vector(1536),
      } as const;

      const UserBase = model('User', {
        fields: {
          id: field.column(int4Column).id({ name: 'user_pkey' }),
          email: field.text().unique({ name: 'user_email_key' }),
          role: field.namedType(types.Role),
          embedding: field.namedType(types.Embedding1536).optional(),
          createdAt: field.temporal.createdAt(),
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
        indexes: [constraints.index([cols.authorId], { name: 'post_author_id_idx' })],
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

function buildSqliteTimestampTsContract() {
  return defineContract(
    {
      family: bareSqlFamilyPack,
      target: sqliteTimestampTargetPack,
    },
    ({ field, model }) => ({
      models: {
        User: model('User', {
          fields: {
            id: field.int().id(),
            email: field.text(),
            createdAt: field.temporal.createdAt(),
            updatedAt: field.temporal.updatedAt(),
          },
        }).sql({ table: 'user' }),
      },
    }),
  );
}

function buildPostgresTimestampTsContract() {
  return defineContract(
    {
      family: bareSqlFamilyPack,
      target: postgresTimestampTargetPack,
    },
    ({ field, model }) => ({
      models: {
        User: model('User', {
          fields: {
            id: field.int().id(),
            email: field.text(),
            createdAt: field.temporal.createdAt(),
            updatedAt: field.temporal.updatedAt(),
          },
        }).sql({ table: 'user' }),
      },
    }),
  );
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
      composedExtensionContracts: new Map(),
      composedExtensionPackRefs: [pgvectorExtensionPack],
    });

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });

  it('keeps the contract DSL within the terseness threshold for the same contract', () => {
    const pslLines = countSemanticLines(representativePslSchema);
    const tsLines = countSemanticLines(representativeTsAuthoring);

    expect(tsLines).toBeLessThanOrEqual(Math.ceil(pslLines * 1.6));
  });

  // The shared timestamp parity schema both SQL targets exercise. Lives at module scope so the per-target tests below read as data + a single call into `expectTimestampParity`.
  const timestampParityPslSchema = `model User {
  id Int @id
  email String
  createdAt DateTime @default(now())
  updatedAt temporal.updatedAt()
}`;

  function expectTimestampParity(target: {
    readonly buildTsContract: () => unknown;
    readonly targetPack: TargetPackRef<'sql', string>;
    readonly scalarTypeDescriptors: ReadonlyMap<string, ColumnTypeDescriptor>;
    readonly authoringContributions: AuthoringContributions;
  }): void {
    const tsContract = target.buildTsContract();
    const pslDocument = parsePslDocument({
      schema: timestampParityPslSchema,
      sourceId: 'schema.prisma',
    });

    const interpreted = interpretPslDocumentToSqlContract({
      document: pslDocument,
      target: target.targetPack,
      scalarTypeDescriptors: target.scalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      authoringContributions: target.authoringContributions,
    });

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;
    expect(interpreted.value).toEqual(tsContract);
  }

  it('lowers SQLite timestamp helpers to the same contract as PSL timestamp attributes', () => {
    expectTimestampParity({
      buildTsContract: buildSqliteTimestampTsContract,
      targetPack: sqliteTimestampTargetPack,
      scalarTypeDescriptors: sqliteTimestampScalarTypeDescriptors,
      authoringContributions: sqliteTimestampAuthoringContributions,
    });
  });

  it('lowers Postgres timestamp helpers to the same contract as PSL timestamp attributes', () => {
    expectTimestampParity({
      buildTsContract: buildPostgresTimestampTsContract,
      targetPack: postgresTimestampTargetPack,
      scalarTypeDescriptors: postgresTimestampScalarTypeDescriptors,
      authoringContributions: postgresTimestampAuthoringContributions,
    });
  });

  it('PSL and TS lower the same cross-namespace FK shape to identical contract IR', () => {
    const pslDocument = parsePslDocument({
      schema: `namespace auth {
  model User {
    id Int @id
    posts Post[]
  }
}

model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const pslContract = interpretPslDocumentToSqlContract({
      document: pslDocument,
      target: portablePostgresTargetPack,
      scalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      authoringContributions,
    });

    expect(pslContract.ok).toBe(true);
    if (!pslContract.ok) return;

    const UserBase = model('User', {
      namespace: 'auth',
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'user' });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
        authorId: field.column(int4Column),
      },
      relations: { author: rel.belongsTo(UserBase, { from: 'authorId', to: 'id' }) },
    }).sql(({ cols, constraints }) => ({
      table: 'post',
      foreignKeys: [constraints.foreignKey(cols.authorId, UserBase.refs.id)],
    }));

    const User = UserBase.relations({
      posts: rel.hasMany(() => Post, { by: 'authorId' }),
    });

    const tsContract = defineContract({
      family: sqlFamilyPack,
      target: portablePostgresTargetPack,
      namespaces: ['auth'],
      models: { User, Post },
    });

    const pslStorage = pslContract.value.storage as unknown as SqlStorage;
    const tsStorage = tsContract.storage as unknown as SqlStorage;
    const pslFks: readonly ForeignKey[] =
      namespaceTables(pslStorage.namespaces['public']!)['post']?.foreignKeys ?? [];
    const tsFks: readonly ForeignKey[] =
      namespaceTables(tsStorage.namespaces['public']!)['post']?.foreignKeys ?? [];

    expect(tsFks.length).toBe(1);
    expect(pslFks.length).toBe(1);
    expect(tsFks[0]).toMatchObject({
      source: { namespaceId: 'public', tableName: 'post' },
      target: { namespaceId: 'auth', tableName: 'user' },
    });
    expect(pslFks[0]).toMatchObject({
      source: { namespaceId: 'public', tableName: 'post' },
      target: { namespaceId: 'auth', tableName: 'user' },
    });
    expect(tsFks).toEqual(pslFks);
  });
});
