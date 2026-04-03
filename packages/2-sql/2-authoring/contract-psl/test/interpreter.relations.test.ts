import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { postgresScalarTypeDescriptors, postgresTarget } from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
} as const;

describe('interpretPslDocumentToSqlContract relations', () => {
  it('accepts relation navigation list fields and emits relation metadata for both sides', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = result.value.models as Record<string, { relations?: Record<string, unknown> }>;
    expect(models['User']?.relations).toMatchObject({
      posts: {
        to: 'Post',
        cardinality: '1:N',
        on: {
          localFields: ['id'],
          targetFields: ['userId'],
        },
      },
    });
    expect(models['Post']?.relations).toMatchObject({
      user: {
        to: 'User',
        cardinality: 'N:1',
        on: {
          localFields: ['userId'],
          targetFields: ['id'],
        },
      },
    });
  });

  it('matches named backrelations using positional and named relation forms', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  authored Post[] @relation("AuthoredPosts")
  reviewed Post[] @relation(name: "ReviewedPosts")
}

model Post {
  id Int @id
  authorId Int
  reviewerId Int
  author User @relation("AuthoredPosts", fields: [authorId], references: [id])
  reviewer User @relation(name: "ReviewedPosts", fields: [reviewerId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = result.value.models as Record<string, { relations?: Record<string, unknown> }>;
    expect(models['User']?.relations).toMatchObject({
      authored: {
        to: 'Post',
        cardinality: '1:N',
        on: {
          localFields: ['id'],
          targetFields: ['authorId'],
        },
      },
      reviewed: {
        to: 'Post',
        cardinality: '1:N',
        on: {
          localFields: ['id'],
          targetFields: ['reviewerId'],
        },
      },
    });
  });

  it('matches backrelations with unrelated FK metadata present', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}

model Team {
  id Int @id
}

model Member {
  id Int @id
  teamId Int
  team Team @relation(fields: [teamId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = result.value.models as Record<string, { relations?: Record<string, unknown> }>;
    expect(models['User']?.relations).toMatchObject({
      posts: { to: 'Post', cardinality: '1:N' },
    });
    expect(models['Post']?.relations).toMatchObject({
      user: { to: 'User', cardinality: 'N:1' },
    });
    expect(models['Member']?.relations).toMatchObject({
      team: { to: 'Team', cardinality: 'N:1' },
    });
  });

  it('matches self-referential backrelations when disambiguated by relation name', () => {
    const document = parsePslDocument({
      schema: `model Employee {
  id Int @id
  managerId Int?
  manager Employee? @relation("Manages", fields: [managerId], references: [id])
  reports Employee[] @relation("Manages")
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = result.value.models as Record<string, { relations?: Record<string, unknown> }>;
    expect(models['Employee']?.relations).toMatchObject({
      manager: {
        to: 'Employee',
        cardinality: 'N:1',
        on: {
          localFields: ['managerId'],
          targetFields: ['id'],
        },
      },
      reports: {
        to: 'Employee',
        cardinality: '1:N',
        on: {
          localFields: ['id'],
          targetFields: ['managerId'],
        },
      },
    });
  });

  it('returns diagnostics for ambiguous self-referential backrelations without a relation name', () => {
    const document = parsePslDocument({
      schema: `model Employee {
  id Int @id
  managerId Int?
  mentorId Int?
  manager Employee? @relation(fields: [managerId], references: [id])
  mentor Employee? @relation(fields: [mentorId], references: [id])
  reports Employee[]
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

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
    const document = parsePslDocument({
      schema: `model Team {
  id Int @id @map("team_id")
  members Member[]
  @@map("org_team")
}

model Member {
  id Int @id @map("member_id")
  teamId Int @map("team_ref")
  team Team @relation(fields: [teamId], references: [id], map: "team_member_team_ref_fkey")

  @@map("team_member")
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as unknown as {
      readonly tables: Record<string, { readonly foreignKeys?: readonly unknown[] }>;
    };
    const memberTable = storage.tables['team_member'];
    expect(memberTable).toBeDefined();
    const fks = memberTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({ name: 'team_member_team_ref_fkey' });
  });
});
