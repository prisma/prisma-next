import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertPrismaSchemaToContract } from '../src/contract-converter';

describe('convertPrismaSchemaToContract', () => {
  it('converts a relational schema with enums, defaults, and foreign keys', async () => {
    const schema = `
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  USER
  ADMIN
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  role      Role     @default(USER)
  createdAt DateTime @default(now())
  posts     Post[]
}

model Post {
  id        String   @id @default(cuid())
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  title     String
  published Boolean  @default(false)

  @@index([authorId])
}
`;

    const result = await convertPrismaSchemaToContract({ schema });
    const userTable = result.contract.storage.tables['User'];
    const postTable = result.contract.storage.tables['Post'];

    expect(result.provider).toBe('postgresql');
    expect(userTable).toBeDefined();
    expect(postTable).toBeDefined();
    expect(userTable.columns['id']?.nativeType).toBe('text');
    expect(userTable.columns['role']?.typeRef).toBe('Role');
    expect(postTable.foreignKeys).toContainEqual({
      columns: ['authorId'],
      references: {
        table: 'User',
        columns: ['id'],
      },
    });
    expect(result.contract.execution?.mutations.defaults).toContainEqual({
      ref: {
        table: 'User',
        column: 'id',
      },
      onCreate: {
        kind: 'generator',
        id: 'uuidv4',
      },
    });
  });

  it('records unsupported PSL features in missingFeatures', async () => {
    const schema = `
datasource db {
  provider = "postgresql"
  schemas = ["tenant_1"]
}

model User {
  id String @id
  payload Unsupported("jsonpath")?

  @@schema("tenant_1")
}
`;

    const result = await convertPrismaSchemaToContract({ schema });
    expect(result.missingFeatures.length).toBeGreaterThan(0);
    expect(result.missingFeatures.join('\n')).toContain('Unsupported(...) fields');
    expect(result.missingFeatures.join('\n')).toContain('schema');
  });

  it('parses complex real-world schemas from prisma-examples list', async () => {
    const fixtures = [
      resolve('test/fixtures/prisma-examples/inbox-zero.schema.prisma'),
      resolve('test/fixtures/prisma-examples/nextcrm.schema.prisma'),
    ];

    for (const schemaPath of fixtures) {
      const result = await convertPrismaSchemaToContract({ schemaPath });
      expect(result.provider).toBe('postgresql');
      expect(Object.keys(result.contract.models).length).toBeGreaterThan(10);
      expect(Object.keys(result.contract.storage.tables).length).toBeGreaterThan(10);
      expect(/^\s*url\s*=/m.test(result.sanitizedSchema)).toBe(false);
      expect(/^\s*directUrl\s*=/m.test(result.sanitizedSchema)).toBe(false);
    }
  });
});
