import { crossRef } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

describe('interpretPslDocumentToSqlContract relations', () => {
  it('accepts relation navigation list fields and emits relation metadata for both sides', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: [userId], to: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({
      user: crossRef('User', 'public'),
      post: crossRef('Post', 'public'),
    });

    const models = modelsOf(result.value) as Record<
      string,
      { relations?: Record<string, unknown> }
    >;
    expect(models['User']?.relations).toMatchObject({
      posts: {
        to: crossRef('Post', 'public'),
        cardinality: '1:N',
        on: {
          localFields: ['id'],
          targetFields: ['userId'],
        },
      },
    });
    expect(models['Post']?.relations).toMatchObject({
      user: {
        to: crossRef('User', 'public'),
        cardinality: 'N:1',
        on: {
          localFields: ['userId'],
          targetFields: ['id'],
        },
      },
    });
  });

  it('matches named backrelations using positional and named relation forms', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  authored Post[] @relation("AuthoredPosts")
  reviewed Post[] @relation(name: "ReviewedPosts")
}

model Post {
  id Int @id
  authorId Int
  reviewerId Int
  author User @relation("AuthoredPosts", from: [authorId], to: [id])
  reviewer User @relation(name: "ReviewedPosts", from: [reviewerId], to: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = modelsOf(result.value) as Record<
      string,
      { relations?: Record<string, unknown> }
    >;
    expect(models['User']?.relations).toMatchObject({
      authored: {
        to: crossRef('Post', 'public'),
        cardinality: '1:N',
        on: {
          localFields: ['id'],
          targetFields: ['authorId'],
        },
      },
      reviewed: {
        to: crossRef('Post', 'public'),
        cardinality: '1:N',
        on: {
          localFields: ['id'],
          targetFields: ['reviewerId'],
        },
      },
    });
  });

  it('matches backrelations with unrelated FK metadata present', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: [userId], to: [id])
}

model Team {
  id Int @id
}

model Member {
  id Int @id
  teamId Int
  team Team @relation(from: [teamId], to: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({
      user: crossRef('User', 'public'),
      post: crossRef('Post', 'public'),
      team: crossRef('Team', 'public'),
      member: crossRef('Member', 'public'),
    });

    const models = modelsOf(result.value) as Record<
      string,
      { relations?: Record<string, unknown> }
    >;
    expect(models['User']?.relations).toMatchObject({
      posts: { to: crossRef('Post', 'public'), cardinality: '1:N' },
    });
    expect(models['Post']?.relations).toMatchObject({
      user: { to: crossRef('User', 'public'), cardinality: 'N:1' },
    });
    expect(models['Member']?.relations).toMatchObject({
      team: { to: crossRef('Team', 'public'), cardinality: 'N:1' },
    });
  });

  it('matches self-referential backrelations when disambiguated by relation name', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Employee {
  id Int @id
  managerId Int?
  manager Employee? @relation("Manages", from: [managerId], to: [id])
  reports Employee[] @relation("Manages")
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = modelsOf(result.value) as Record<
      string,
      { relations?: Record<string, unknown> }
    >;
    expect(models['Employee']?.relations).toMatchObject({
      manager: {
        to: crossRef('Employee', 'public'),
        cardinality: 'N:1',
        on: {
          localFields: ['managerId'],
          targetFields: ['id'],
        },
      },
      reports: {
        to: crossRef('Employee', 'public'),
        cardinality: '1:N',
        on: {
          localFields: ['id'],
          targetFields: ['managerId'],
        },
      },
    });
  });

  it('returns diagnostics for ambiguous self-referential backrelations without a relation name', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Employee {
  id Int @id
  managerId Int?
  mentorId Int?
  manager Employee? @relation(from: [managerId], to: [id])
  mentor Employee? @relation(from: [mentorId], to: [id])
  reports Employee[]
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_AMBIGUOUS_BACKRELATION_LIST',
          message: expect.stringContaining('Employee.reports'),
        }),
      ]),
    );
  });

  it('accepts Prisma relation map argument and records foreign key constraint name', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Team {
  id Int @id @map("team_id")
  members Member[]
  @@map("org_team")
}

model Member {
  id Int @id @map("member_id")
  teamId Int @map("team_ref")
  team Team @relation(from: [teamId], to: [id], map: "team_member_team_ref_fkey")

  @@map("team_member")
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({
      org_team: crossRef('Team', 'public'),
      team_member: crossRef('Member', 'public'),
    });

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const memberTable = unboundTables(storage)['team_member'];
    expect(memberTable).toBeDefined();
    const fks = memberTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({ name: 'team_member_team_ref_fkey' });
  });

  it('returns diagnostics for unsupported referential action tokens', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
}

model Post {
  id Int @id
  userId Int
  author User @relation(from: [userId], to: [id], onDelete: WeirdAction)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          sourceId: 'schema.prisma',
        }),
      ]),
    );
  });

  it('returns diagnostics when relation fields reference unknown local fields', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: [missingUserId], to: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: expect.stringContaining('Field "missingUserId" does not exist on model "Post"'),
        }),
      ]),
    );
  });

  it('returns diagnostics when relation references target unknown fields', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: [userId], to: [missingId])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: expect.stringContaining('Field "missingId" does not exist on model "User"'),
        }),
      ]),
    );
  });

  it('returns diagnostics when relation fields repeats a column name', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: [userId, userId], to: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: expect.stringContaining('Duplicate'),
        }),
      ]),
    );
  });

  it('returns diagnostics when relation omits the required local-fields argument', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
}

model Post {
  id Int @id
  userId Int
  user User @relation(to: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message:
            'Relation field "Post.user" requires a from argument naming the local foreign-key field(s)',
        }),
      ]),
    );
  });
});
