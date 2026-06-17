import { describe, expect, it } from 'vitest';
import { format, PslFormatError } from '../../src/exports/format';

describe('format', () => {
  it('emits one declaration per line with the field cells aligned per block', () => {
    const out = format('model User {\nid Int @id\nemail String @unique\n}');
    expect(out).toEqual(
      ['model User {', '  id    Int    @id', '  email String @unique', '}', ''].join('\n'),
    );
  });

  it('collapses arbitrary whitespace inside a declaration to canonical single spaces', () => {
    const out = format('model    User    {\n   id     Int      @id\n}');
    expect(out).toEqual(['model User {', '  id Int @id', '}', ''].join('\n'));
  });

  it('separates a field from multiple attributes with single spaces', () => {
    const out = format('model User {\nid Int @id @default(autoincrement())\n}');
    expect(out).toEqual(
      ['model User {', '  id Int @id @default(autoincrement())', '}', ''].join('\n'),
    );
  });

  it('renders block attributes with the @@ prefix preserved', () => {
    const out = format('model User {\nid Int\n@@id([id])\n}');
    expect(out).toEqual(['model User {', '  id Int', '  @@id([id])', '}', ''].join('\n'));
  });

  it('renders attribute argument lists as key: value with comma-space separators', () => {
    const out = format('model User {\nname String @map(name:"user_name",length:255)\n}');
    expect(out).toEqual(
      ['model User {', '  name String @map(name: "user_name", length: 255)', '}', ''].join('\n'),
    );
  });

  it('renders namespaced attributes with their namespace prefix', () => {
    const out = format('model User {\nid Int @db.Uuid\n}');
    expect(out).toEqual(['model User {', '  id Int @db.Uuid', '}', ''].join('\n'));
  });

  it('formats an enum declaration through the generic-block path', () => {
    const out = format('enum Role {\nUSER\nADMIN\n@@map("roles")\n}');
    expect(out).toEqual(
      ['enum Role {', '  USER', '  ADMIN', '  @@map("roles")', '}', ''].join('\n'),
    );
  });

  it('renders a bare enum member as the key alone, not key followed by =', () => {
    const out = format('enum Status {\nActive\nInactive\n}');
    expect(out).toEqual(['enum Status {', '  Active', '  Inactive', '}', ''].join('\n'));
  });

  it('formats a composite type declaration', () => {
    const out = format('type Address {\nstreet String\ncity String\n}');
    expect(out).toEqual(
      ['type Address {', '  street String', '  city   String', '}', ''].join('\n'),
    );
  });

  it('formats a types block with named type declarations', () => {
    const out = format('types {\nEmail = String\nAge = Int\n}');
    expect(out).toEqual(['types {', '  Email = String', '  Age = Int', '}', ''].join('\n'));
  });

  it('formats a namespace block with nested declarations indented per depth', () => {
    const out = format('namespace billing {\nmodel Invoice {\nid Int @id\n}\n}');
    expect(out).toEqual(
      ['namespace billing {', '  model Invoice {', '    id Int @id', '  }', '}', ''].join('\n'),
    );
  });

  it('formats a generic key = value block with a single space around =', () => {
    const out = format('datasource db {\nprovider="postgresql"\nurl=env("DATABASE_URL")\n}');
    expect(out).toEqual(
      ['datasource db {', '  provider = "postgresql"', '  url = env("DATABASE_URL")', '}', ''].join(
        '\n',
      ),
    );
  });

  it('formats a generic block without a name', () => {
    const out = format('generator {\noutput="./client"\n}');
    expect(out).toEqual(['generator {', '  output = "./client"', '}', ''].join('\n'));
  });

  it('preserves source order of declarations', () => {
    const out = format('enum B {\nX\n}\nmodel A {\nid Int\n}');
    expect(out).toEqual(['enum B {', '  X', '}', 'model A {', '  id Int', '}', ''].join('\n'));
  });
});

describe('format refuse-on-diagnostics', () => {
  it('throws PslFormatError carrying diagnostics on diagnostic-bearing input', () => {
    expect(() => format('model {\n}')).toThrow(PslFormatError);
  });

  it('exposes the parser diagnostics on the thrown error', () => {
    let thrown: unknown;
    try {
      format('model {\n}');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PslFormatError);
    const error = thrown as PslFormatError;
    expect(error.diagnostics.length).toBeGreaterThan(0);
    expect(error.diagnostics[0]?.message).toBeTypeOf('string');
  });

  it('does not emit best-effort output for malformed input', () => {
    expect(() => format('model User {\nid Int @\n}')).toThrow(PslFormatError);
  });
});
