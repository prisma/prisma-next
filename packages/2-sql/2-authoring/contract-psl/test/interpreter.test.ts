import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContractIR } from '../src/interpreter';

describe('interpretPslDocumentToSqlContractIR', () => {
  it('builds sql contract ir from simple psl schema', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  email String
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.targetFamily).toBe('sql');
    expect(result.value.target).toBe('postgres');
    expect(result.value.storage).toMatchObject({
      tables: {
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4' },
            email: { codecId: 'pg/text@1', nativeType: 'text' },
          },
          primaryKey: { columns: ['id'] },
        },
      },
    });
    expect(result.value.models).toMatchObject({
      User: {
        storage: { table: 'user' },
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
      },
    });
  });

  it('maps enums, named types, defaults, indexes, and foreign keys', () => {
    const document = parsePslDocument({
      schema: `types {
  Email = String
}

enum Role {
  USER
  ADMIN
}

model User {
  id Int @id @default(autoincrement())
  email Email @unique
  role Role
  createdAt DateTime @default(now())
  isActive Boolean @default(true)
  nickname String?
}

model Post {
  id Int @id
  userId Int
  title String
  author User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: SetNull)
  @@index([userId])
  @@unique([title, userId])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      types: {
        Email: { codecId: 'pg/text@1', nativeType: 'text' },
        Role: { codecId: 'pg/enum@1', nativeType: 'role' },
      },
      tables: {
        user: {
          columns: {
            id: {
              default: { kind: 'function', expression: 'autoincrement()' },
            },
            createdAt: {
              default: { kind: 'function', expression: 'now()' },
            },
            isActive: {
              default: { kind: 'literal', value: true },
            },
            nickname: {
              nullable: true,
            },
          },
        },
        post: {
          uniques: [{ columns: ['title', 'userId'] }],
          indexes: [{ columns: ['userId'] }],
          foreignKeys: [
            {
              columns: ['userId'],
              references: {
                table: 'user',
                columns: ['id'],
              },
              onDelete: 'cascade',
              onUpdate: 'setNull',
            },
          ],
        },
      },
    });
  });

  it('returns diagnostics for unsupported referential action tokens', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
}

model Post {
  id Int @id
  userId Int
  author User @relation(fields: [userId], references: [id], onDelete: WeirdAction)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_REFERENTIAL_ACTION',
          sourceId: 'schema.prisma',
        }),
      ]),
    );
  });

  it('returns diagnostics for unsupported named types, field lists, missing keys, and invalid relation targets', () => {
    const document = parsePslDocument({
      schema: `types {
  DisplayName = String @db.VarChar(191)
  Weird = Unsupported
}

model Team {
  name String
}

model User {
  id Int @id
  tags String[]
  ghost Ghost @relation(fields: [ghostId], references: [id])
  ghostId Int
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        'PSL_MISSING_PRIMARY_KEY',
        'PSL_UNSUPPORTED_FIELD_LIST',
        'PSL_UNSUPPORTED_FIELD_TYPE',
        'PSL_INVALID_RELATION_TARGET',
      ]),
    );
  });

  it('maps @@map and @map to storage table and column names', () => {
    const document = parsePslDocument({
      schema: `model Team {
  id Int @id @map("team_id")
  @@map("org_team")
}

model Member {
  id Int @id @map("member_id")
  teamId Int @map("team_ref")
  team Team @relation(fields: [teamId], references: [id])
  @@map("team_member")
  @@index([teamId])
  @@unique([teamId, id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage['tables']).toMatchObject({
      org_team: {
        columns: {
          team_id: { codecId: 'pg/int4@1', nativeType: 'int4' },
        },
        primaryKey: { columns: ['team_id'] },
      },
      team_member: {
        columns: {
          member_id: { codecId: 'pg/int4@1', nativeType: 'int4' },
          team_ref: { codecId: 'pg/int4@1', nativeType: 'int4' },
        },
        primaryKey: { columns: ['member_id'] },
        indexes: [{ columns: ['team_ref'] }],
        uniques: [{ columns: ['team_ref', 'member_id'] }],
        foreignKeys: [
          {
            columns: ['team_ref'],
            references: { table: 'org_team', columns: ['team_id'] },
          },
        ],
      },
    });
    expect(result.value.models).toMatchObject({
      Team: {
        storage: { table: 'org_team' },
        fields: { id: { column: 'team_id' } },
      },
      Member: {
        storage: { table: 'team_member' },
        fields: {
          id: { column: 'member_id' },
          teamId: { column: 'team_ref' },
        },
      },
    });
  });

  it('returns diagnostics when @map and @@map arguments are not quoted string literals', () => {
    const document = parsePslDocument({
      schema: `model Team {
  id Int @id @map(team_id)
  @@map(org_team)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining(
            '@map requires a positional quoted string literal argument',
          ),
        }),
      ]),
    );
  });

  it('returns diagnostics when relation fields reference unknown local fields', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [missingUserId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining(
            'Relation field "Post.user" references unknown field "Post.missingUserId"',
          ),
        }),
      ]),
    );
  });

  it('returns diagnostics when relation references target unknown fields', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [missingId])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining(
            'Relation field "Post.user" references unknown field "User.missingId"',
          ),
        }),
      ]),
    );
  });

  it('returns diagnostics when relation omits required fields argument', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
}

model Post {
  id Int @id
  userId Int
  user User @relation(references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: 'Relation field "Post.user" requires fields and references arguments',
        }),
      ]),
    );
  });

  it('returns diagnostics for unsupported model attributes', () => {
    const document = parsePslDocument({
      schema: `model Team {
  id Int @id
  @@unsupported([id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
          message: 'Model "Team" uses unsupported attribute "@@unsupported"',
        }),
      ]),
    );
  });

  it('returns diagnostics for model attributes with unrecognized extension namespace', () => {
    const document = parsePslDocument({
      schema: `model Team {
  id Int @id
  @@pgvector.index(length: 3)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({
      document,
      composedExtensionPacks: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          message: expect.stringContaining('uses unrecognized namespace "pgvector"'),
        }),
      ]),
    );
  });

  it('maps pgvector attributes on named types and fields to vector descriptor shape', () => {
    const namedTypeDocument = parsePslDocument({
      schema: `types {
  Embedding1536 = Bytes @pgvector.column(length: 1536)
}

model Document {
  id Int @id
  embedding Embedding1536
}
`,
      sourceId: 'schema.prisma',
    });

    const namedTypeResult = interpretPslDocumentToSqlContractIR({
      document: namedTypeDocument,
      composedExtensionPacks: ['pgvector'],
    });
    expect(namedTypeResult.ok).toBe(true);
    if (!namedTypeResult.ok) return;
    expect(namedTypeResult.value.storage['types']).toMatchObject({
      Embedding1536: {
        codecId: 'pg/vector@1',
        nativeType: 'vector(1536)',
        typeParams: { length: 1536 },
      },
    });

    const fieldDocument = parsePslDocument({
      schema: `model Document {
  id Int @id
  embedding Bytes @pgvector.column(length: 1536)
}
`,
      sourceId: 'schema.prisma',
    });
    const fieldResult = interpretPslDocumentToSqlContractIR({
      document: fieldDocument,
      composedExtensionPacks: ['pgvector'],
    });
    expect(fieldResult.ok).toBe(true);
    if (!fieldResult.ok) return;
    const fieldTables = fieldResult.value.storage['tables'] as Record<string, unknown>;
    const documentTable = fieldTables['document'] as {
      columns: Record<string, unknown>;
    };
    expect(documentTable.columns['embedding']).toMatchObject({
      codecId: 'pg/vector@1',
      nativeType: 'vector(1536)',
      typeParams: { length: 1536 },
    });
  });

  it('returns diagnostics when namespace is unrecognized', () => {
    const document = parsePslDocument({
      schema: `model Document {
  id Int @id
  embedding Bytes @pgvector.column(length: 1536)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({
      document,
      composedExtensionPacks: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 3 }),
          }),
        }),
      ]),
    );
  });

  it('returns diagnostics for unsupported list fields', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  tags String[]
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_UNSUPPORTED_FIELD_LIST' })]),
    );
  });

  it('preserves parser diagnostics with source spans', () => {
    const document = parsePslDocument({
      schema: `datasource db {
  provider = "postgresql"
}

model User {
  id Int @id
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 1, column: 1 }),
            end: expect.objectContaining({ line: 1 }),
          }),
        }),
      ]),
    );
  });
});
