import { describe, expect, it } from 'vitest';
import { sanitizePrismaSchemaForPrisma7 } from '../src/schema-normalize';

describe('sanitizePrismaSchemaForPrisma7', () => {
  it('removes url and directUrl from datasource blocks', () => {
    const schema = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
}

model User {
  id String @id @default(cuid())
}
`;

    const sanitized = sanitizePrismaSchemaForPrisma7(schema);
    expect(sanitized).toContain('provider = "postgresql"');
    expect(sanitized).not.toContain('url = env("DATABASE_URL")');
    expect(sanitized).not.toContain('directUrl = env("DIRECT_DATABASE_URL")');
    expect(sanitized).not.toContain('shadowDatabaseUrl = env("SHADOW_DATABASE_URL")');
    expect(sanitized).toContain('model User');
  });

  it('leaves schemas without datasource url fields unchanged', () => {
    const schema = `datasource db {
  provider = "postgresql"
}`;
    expect(sanitizePrismaSchemaForPrisma7(schema)).toBe(schema);
  });
});
