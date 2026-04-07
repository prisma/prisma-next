import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

describe('interpretPslDocumentToSqlContract', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPslDocumentToSqlContract = (
    input: Omit<InterpretPslDocumentToSqlContractInput, 'target' | 'scalarTypeDescriptors'>,
  ) =>
    interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      ...input,
    });

  it('uses composed scalar type descriptors without hardcoded fallback', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  email String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractInternal({
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
    expect(result.value.roots).toEqual({ user: 'User' });
  });

  it('does not derive generated column type without descriptor resolver', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  slug String @default(slugid())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractInternal({
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

  it('populates roots from models', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  email String
}

model Post {
  id Int @id
  title String
  userId Int
  author User @relation(fields: [userId], references: [id])
}

model Comment {
  id Int @id
  body String
  postId Int
  post Post @relation(fields: [postId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({
      user: 'User',
      post: 'Post',
      comment: 'Comment',
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

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.targetFamily).toBe('sql');
    expect(result.value.target).toBe('postgres');
    expect(result.value.roots).toEqual({ user: 'User' });
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
        storage: {
          table: 'user',
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
          },
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
  author User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  @@index([userId])
  @@unique([title, userId])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({ user: 'User', post: 'Post' });
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
              onUpdate: 'cascade',
            },
          ],
        },
      },
    });
    const models = result.value.models as Record<string, { relations?: Record<string, unknown> }>;
    expect(models['Post']?.relations).toMatchObject({
      author: {
        to: 'User',
        cardinality: 'N:1',
        on: {
          localFields: ['userId'],
          targetFields: ['id'],
        },
      },
    });
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

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({ org_team: 'Team', team_member: 'Member' });
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
        storage: {
          table: 'org_team',
          fields: { id: { column: 'team_id' } },
        },
      },
      Member: {
        storage: {
          table: 'team_member',
          fields: {
            id: { column: 'member_id' },
            teamId: { column: 'team_ref' },
          },
        },
      },
    });
  });

  it('emits composite types as valueObjects', () => {
    const document = parsePslDocument({
      schema: `type Address {
  street String
  city String
  zip String?
}

model User {
  id Int @id
  name String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.valueObjects).toEqual({
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          zip: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        },
      },
    });
  });

  it('emits value object field references with valueObject domain type and JSONB storage', () => {
    const document = parsePslDocument({
      schema: `type Address {
  street String
  city String
}

model User {
  id Int @id
  homeAddress Address?
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.models).toMatchObject({
      User: {
        fields: {
          homeAddress: {
            nullable: true,
            type: { kind: 'valueObject', name: 'Address' },
          },
        },
      },
    });

    expect(result.value.storage).toMatchObject({
      tables: {
        user: {
          columns: {
            homeAddress: {
              nativeType: 'jsonb',
              codecId: 'pg/jsonb@1',
              nullable: true,
            },
          },
        },
      },
    });
  });

  it('emits scalar list fields with many: true', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  tags String[]
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.models).toMatchObject({
      User: {
        fields: {
          tags: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: true,
          },
        },
      },
    });

    expect(result.value.storage).toMatchObject({
      tables: {
        user: {
          columns: {
            tags: {
              nativeType: 'jsonb',
              codecId: 'pg/jsonb@1',
              nullable: false,
            },
          },
        },
      },
    });
  });

  it('emits value object list fields with many: true and valueObject domain type', () => {
    const document = parsePslDocument({
      schema: `type Address {
  street String
  city String
}

model User {
  id Int @id
  addresses Address[]
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.models).toMatchObject({
      User: {
        fields: {
          addresses: {
            nullable: false,
            type: { kind: 'valueObject', name: 'Address' },
            many: true,
          },
        },
      },
    });

    expect(result.value.storage).toMatchObject({
      tables: {
        user: {
          columns: {
            addresses: {
              nativeType: 'jsonb',
              codecId: 'pg/jsonb@1',
              nullable: false,
            },
          },
        },
      },
    });
  });

  it('omits valueObjects from contract when no composite types exist', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  name String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.valueObjects).toBeUndefined();
  });
});
