import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

const lines = (...parts: string[]): string => parts.join('\n');

describe('blank line before block-level attributes', () => {
  it('inserts a blank line between the last field and the first @@ attribute', () => {
    const out = format('model User {\nid Int @id\nemail String @unique\n@@index([email])\n}');
    expect(out).toEqual(
      lines(
        'model User {',
        '  id    Int    @id',
        '  email String @unique',
        '',
        '  @@index([email])',
        '}',
        '',
      ),
    );
  });

  it('inserts a blank line before the first @@ attribute in an enum', () => {
    const out = format('enum Role {\nUSER\nADMIN\n@@map("roles")\n}');
    expect(out).toEqual(lines('enum Role {', '  USER', '  ADMIN', '', '  @@map("roles")', '}', ''));
  });

  it('keeps a run of @@ attributes together with no blank line between them', () => {
    const out = format('model User {\nid Int @id\n@@index([id])\n@@map("user")\n}');
    expect(out).toEqual(
      lines('model User {', '  id Int @id', '', '  @@index([id])', '  @@map("user")', '}', ''),
    );
  });

  it('collapses an author-written blank before the first @@ attribute to exactly one', () => {
    const out = format('model User {\nid Int @id\n\n\n\n@@map("user")\n}');
    expect(out).toEqual(lines('model User {', '  id Int @id', '', '  @@map("user")', '}', ''));
  });

  it('does not emit a leading blank when a block has @@ attributes but no fields', () => {
    const out = format('model User {\n@@map("user")\n}');
    expect(out).toEqual(lines('model User {', '  @@map("user")', '}', ''));
  });

  it('puts the inserted blank before a comment that leads the first @@ attribute', () => {
    const out = format('model User {\nid Int @id\n// the table name\n@@map("user")\n}');
    expect(out).toEqual(
      lines('model User {', '  id Int @id', '', '  // the table name', '  @@map("user")', '}', ''),
    );
  });

  it('is idempotent: re-formatting an already-spaced block does not add a second blank', () => {
    const once = format('model User {\nid Int @id\nemail String @unique\n@@index([email])\n}');
    expect(format(once)).toEqual(once);
  });

  it('is idempotent for the enum @@ case', () => {
    const once = format('enum Role {\nUSER\nADMIN\n@@map("roles")\n}');
    expect(format(once)).toEqual(once);
  });
});
