import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToSqlContractIRInput,
  interpretPslDocumentToSqlContractIR as interpretPslDocumentToSqlContractIRInternal,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

describe('interpretPslDocumentToSqlContractIR', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPslDocumentToSqlContractIR = (
    input: Omit<InterpretPslDocumentToSqlContractIRInput, 'target' | 'scalarTypeDescriptors'>,
  ) =>
    interpretPslDocumentToSqlContractIRInternal({
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      ...input,
    });

  it('returns diagnostics when target context is missing', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
}`,
      sourceId: 'schema.prisma',
    });

    // Intentionally bypasses strict input typing to verify missing target diagnostics.
    const result = interpretPslDocumentToSqlContractIRInternal({
      document,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
    } as unknown as InterpretPslDocumentToSqlContractIRInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_TARGET_CONTEXT_REQUIRED',
        }),
      ]),
    );
  });

  it('uses composed scalar type descriptors without hardcoded fallback', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  email String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIRInternal({
      document,
      target: postgresTarget,
      scalarTypeDescriptors: new Map([
        ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
        ['String', { codecId: 'custom/text@1', nativeType: 'custom_text' }],
      ]),
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      tables: {
        user: {
          columns: {
            email: {
              codecId: 'custom/text@1',
              nativeType: 'custom_text',
            },
          },
        },
      },
    });
  });

  it('does not derive generated column type without descriptor resolver', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  slug String @default(slugid())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIRInternal({
      document,
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      controlMutationDefaults: {
        defaultFunctionRegistry: new Map([
          [
            'slugid',
            {
              lower: () => ({
                ok: true as const,
                value: {
                  kind: 'execution' as const,
                  generated: { kind: 'generator' as const, id: 'slugid' },
                },
              }),
              usageSignatures: ['slugid()'],
            },
          ],
        ]),
        generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      tables: {
        user: {
          columns: {
            slug: {
              codecId: 'pg/text@1',
              nativeType: 'text',
            },
          },
        },
      },
    });
  });
  it('builds sql contract ir from simple psl schema', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  email String
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      types: {
        Email: { codecId: 'pg/text@1', nativeType: 'text' },
        Role: { codecId: 'pg/enum@1', nativeType: 'Role' },
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
    expect(result.value.relations).toMatchObject({
      post: {
        author: {
          to: 'User',
          cardinality: 'N:1',
          on: {
            parentCols: ['userId'],
            childCols: ['id'],
          },
        },
      },
    });
  });

  it('lowers preserved native type named types into storage descriptors', () => {
    const document = parsePslDocument({
      schema: `types {
  Id = String @db.Uuid
  Slug = String @db.VarChar(191)
  Rating = Int @db.SmallInt
  HappenedAt = DateTime @db.Time(3)
  PublishDay = DateTime @db.Date
  Payload = Json @db.Json
  Amount = Decimal @db.Numeric(10, 2)
}

model Event {
  id Id @id
  slug Slug
  rating Rating
  happenedAt HappenedAt
  publishDay PublishDay
  payload Payload
  amount Amount
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      types: {
        Id: { codecId: 'pg/text@1', nativeType: 'uuid' },
        Slug: {
          codecId: 'sql/varchar@1',
          nativeType: 'character varying',
          typeParams: { length: 191 },
        },
        Rating: { codecId: 'pg/int2@1', nativeType: 'int2' },
        HappenedAt: {
          codecId: 'pg/time@1',
          nativeType: 'time',
          typeParams: { precision: 3 },
        },
        PublishDay: { codecId: 'pg/timestamptz@1', nativeType: 'date' },
        Payload: { codecId: 'pg/json@1', nativeType: 'json' },
        Amount: {
          codecId: 'pg/numeric@1',
          nativeType: 'numeric',
          typeParams: { precision: 10, scale: 2 },
        },
      },
      tables: {
        event: {
          columns: {
            id: { codecId: 'pg/text@1', nativeType: 'uuid' },
            slug: {
              codecId: 'sql/varchar@1',
              nativeType: 'character varying',
              typeParams: { length: 191 },
            },
            rating: { codecId: 'pg/int2@1', nativeType: 'int2' },
            happenedAt: {
              codecId: 'pg/time@1',
              nativeType: 'time',
              typeParams: { precision: 3 },
            },
            publishDay: { codecId: 'pg/timestamptz@1', nativeType: 'date' },
            payload: { codecId: 'pg/json@1', nativeType: 'json' },
            amount: {
              codecId: 'pg/numeric@1',
              nativeType: 'numeric',
              typeParams: { precision: 10, scale: 2 },
            },
          },
          primaryKey: { columns: ['id'] },
        },
      },
    });
  });

  it('preserves enum native type names from @@map instead of lowercasing declarations', () => {
    const document = parsePslDocument({
      schema: `enum UserRole {
  USER
  ADMIN
  @@map("user_role")
}

enum Role {
  OWNER
}

model User {
  id Int @id
  role UserRole
  legacyRole Role
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      types: {
        UserRole: {
          codecId: 'pg/enum@1',
          nativeType: 'user_role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
        Role: {
          codecId: 'pg/enum@1',
          nativeType: 'Role',
          typeParams: { values: ['OWNER'] },
        },
      },
      tables: {
        user: {
          columns: {
            role: { codecId: 'pg/enum@1', nativeType: 'user_role' },
            legacyRole: { codecId: 'pg/enum@1', nativeType: 'Role' },
          },
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

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      tables: {
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

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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
    expect(namedTypeResult.value.storage).toMatchObject({
      types: {
        Embedding1536: {
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
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
    expect(fieldResult.value.storage).toMatchObject({
      tables: {
        document: {
          columns: {
            embedding: {
              codecId: 'pg/vector@1',
              nativeType: 'vector',
              typeParams: { length: 1536 },
            },
          },
        },
      },
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

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

  it('lowers supported default functions into execution and storage contract shapes', () => {
    const document = parsePslDocument({
      schema: `model Defaults {
  id Int @id
  idUuidV4 String @default(uuid())
  idUuidV7 String @default(uuid(7))
  idUlid String @default(ulid())
  idNanoidDefault String @default(nanoid())
  idNanoidSized String @default(nanoid(16))
  dbExpr String @default(dbgenerated("gen_random_uuid()"))
  createdAt DateTime @default(now())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: [
          {
            ref: { table: 'defaults', column: 'idNanoidDefault' },
            onCreate: { kind: 'generator', id: 'nanoid' },
          },
          {
            ref: { table: 'defaults', column: 'idNanoidSized' },
            onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
          },
          {
            ref: { table: 'defaults', column: 'idUlid' },
            onCreate: { kind: 'generator', id: 'ulid' },
          },
          {
            ref: { table: 'defaults', column: 'idUuidV4' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
          {
            ref: { table: 'defaults', column: 'idUuidV7' },
            onCreate: { kind: 'generator', id: 'uuidv7' },
          },
        ],
      },
    });
    expect(result.value.storage).toMatchObject({
      tables: {
        defaults: {
          columns: {
            dbExpr: {
              default: {
                kind: 'function',
                expression: 'gen_random_uuid()',
              },
            },
            createdAt: {
              default: {
                kind: 'function',
                expression: 'now()',
              },
            },
          },
        },
      },
    });
  });

  it('returns diagnostics for unsupported default functions and invalid arguments', () => {
    const document = parsePslDocument({
      schema: `model InvalidDefaults {
  id Int @id
  cuidValue String @default(cuid())
  badUuid String @default(uuid(5))
  badNanoid String @default(nanoid(1))
  emptyDbExpr String @default(dbgenerated(""))
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('cuid'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('uuid'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('nanoid'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('dbgenerated'),
        }),
      ]),
    );
  });
});
