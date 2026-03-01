import { describe, expect, it } from 'vitest';
import { parsePslDocument } from '../src';

describe('parsePslDocument', () => {
  it('parses representative v1 schema with spans', () => {
    const schema = `
types {
  Email = String @db.VarChar(191)
}

enum Role {
  USER
  ADMIN
}

model User {
  id Int @id @default(autoincrement())
  email Email @unique
  role Role
  posts Post[]
}

model Post {
  id Int @id @default(autoincrement())
  userId Int
  user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: SetNull)
  createdAt DateTime @default(now())
  published Boolean @default(true)
  @@index([userId])
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.ast.models).toHaveLength(2);
    expect(result.ast.enums).toHaveLength(1);
    expect(result.ast.types?.declarations).toHaveLength(1);
    expect(result.ast.span.start.line).toBe(1);
    expect(result.ast.span.end.line).toBeGreaterThan(1);

    const userModel = result.ast.models.find((model) => model.name === 'User');
    expect(userModel).toBeDefined();
    const emailField = userModel?.fields.find((field) => field.name === 'email');
    expect(emailField?.typeRef).toBe('Email');

    const postModel = result.ast.models.find((model) => model.name === 'Post');
    const relationField = postModel?.fields.find((field) => field.name === 'user');
    const relationAttribute = relationField?.attributes.find(
      (attribute) => attribute.kind === 'relation',
    );
    expect(relationAttribute).toMatchObject({
      kind: 'relation',
      fields: ['userId'],
      references: ['id'],
      onDelete: 'Cascade',
      onUpdate: 'SetNull',
    });
  });

  it('preserves raw referential action tokens in relation attributes', () => {
    const schema = `
model User {
  id Int @id
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id], onDelete: WeirdAction)
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    expect(
      result.diagnostics.some((entry) => entry.code === 'PSL_INVALID_REFERENTIAL_ACTION'),
    ).toBe(false);
    const postModel = result.ast.models.find((model) => model.name === 'Post');
    const relationField = postModel?.fields.find((field) => field.name === 'user');
    const relationAttribute = relationField?.attributes.find(
      (attribute) => attribute.kind === 'relation',
    );
    expect(relationAttribute).toMatchObject({
      kind: 'relation',
      onDelete: 'WeirdAction',
    });
  });

  it('returns precise diagnostics for invalid relation attribute', () => {
    const schema = `
model User {
  id Int @id
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId])
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find(
      (entry) => entry.code === 'PSL_INVALID_RELATION_ATTRIBUTE',
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain('fields and references');
    expect(diagnostic?.sourceId).toBe('schema.prisma');
    expect(diagnostic?.span.start.line).toBe(9);
    expect(diagnostic?.span.end.line).toBe(9);
  });

  it('fails strictly for unsupported constructs', () => {
    const schema = `
datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}

model User {
  id Int @id
  @@map("users")
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((entry) => entry.code === 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK'),
    ).toBe(true);
    expect(
      result.diagnostics.some((entry) => entry.code === 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE'),
    ).toBe(true);
  });

  it('is deterministic for identical input', () => {
    const schema = `
model User {
  id Int @id
  email String @unique
}
`;

    const first = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });
    const second = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(first).toEqual(second);
  });

  it('parses blocks with braces inside string defaults', () => {
    const schema = `
model User {
  id Int @id
  pattern String @default("{foo}")
}

model Post {
  id Int @id
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.ast.models.map((model) => model.name)).toEqual(['User', 'Post']);
  });

  it('returns diagnostics when named types collide with scalar or model names', () => {
    const schema = `
types {
  String = String @db.VarChar(191)
  User = String @db.VarChar(191)
}

model User {
  id Int @id
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(false);
    const messages = result.diagnostics
      .filter((entry) => entry.code === 'PSL_INVALID_TYPES_MEMBER')
      .map((entry) => entry.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('conflicts with scalar type "String"'),
        expect.stringContaining('conflicts with model name "User"'),
      ]),
    );
  });

  it('returns diagnostics when named types collide with enum names', () => {
    const schema = `
types {
  Role = String
}

enum Role {
  USER
  ADMIN
}

model User {
  id Int @id
  role Role
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(false);
    const messages = result.diagnostics
      .filter((entry) => entry.code === 'PSL_INVALID_TYPES_MEMBER')
      .map((entry) => entry.message);
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining('conflicts with enum name "Role"')]),
    );

    const userModel = result.ast.models.find((model) => model.name === 'User');
    const roleField = userModel?.fields.find((field) => field.name === 'role');
    expect(roleField?.typeName).toBe('Role');
    expect(roleField?.typeRef).toBeUndefined();
  });
});
