import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

const lines = (...parts: string[]): string => parts.join('\n');

describe('format leading own-line comments', () => {
  it('keeps a document-leading comment before the first declaration', () => {
    const out = format('// use prisma-next\nmodel User {\nid Int @id\n}');
    expect(out).toEqual(lines('// use prisma-next', 'model User {', '  id Int @id', '}', ''));
  });

  it('drops the blank line between a leading comment and its construct', () => {
    const out = format('// header\n\nmodel User {\nid Int @id\n}');
    expect(out).toEqual(lines('// header', 'model User {', '  id Int @id', '}', ''));
  });

  it('reattaches a field-level leading comment at the field indent', () => {
    const out = format('model User {\n// the primary key\nid Int @id\n}');
    expect(out).toEqual(lines('model User {', '  // the primary key', '  id Int @id', '}', ''));
  });

  it('keeps multiple consecutive leading comment lines before a construct', () => {
    const out = format('model User {\n// first\n// second\nid Int @id\n}');
    expect(out).toEqual(
      lines('model User {', '  // first', '  // second', '  id Int @id', '}', ''),
    );
  });

  it('reattaches a leading comment before a block attribute', () => {
    const out = format('model User {\nid Int @id\n// the table name\n@@map("user")\n}');
    expect(out).toEqual(
      lines('model User {', '  id Int @id', '  // the table name', '  @@map("user")', '}', ''),
    );
  });

  it('reattaches a leading comment before an enum value', () => {
    const out = format('enum Role {\n// the privileged role\nADMIN\n}');
    expect(out).toEqual(lines('enum Role {', '  // the privileged role', '  ADMIN', '}', ''));
  });

  it('preserves a /// doc comment verbatim as a leading comment', () => {
    const out = format('/// docs for User\nmodel User {\nid Int @id\n}');
    expect(out).toEqual(lines('/// docs for User', 'model User {', '  id Int @id', '}', ''));
  });

  it('does not normalize comment-internal spacing beyond indentation', () => {
    const out = format('model User {\n//no-leading-space  extra   spaces\nid Int @id\n}');
    expect(out).toEqual(
      lines('model User {', '  //no-leading-space  extra   spaces', '  id Int @id', '}', ''),
    );
  });
});

describe('format trailing same-line comments', () => {
  it('reattaches a trailing comment at the end of a field line', () => {
    const out = format('model User {\nid Int @id // the primary key\n}');
    expect(out).toEqual(lines('model User {', '  id Int @id // the primary key', '}', ''));
  });

  it('separates a trailing comment from the construct by a single space', () => {
    const out = format('model User {\nid Int @id      // squished\n}');
    expect(out).toEqual(lines('model User {', '  id Int @id // squished', '}', ''));
  });

  it('reattaches a trailing comment on a block attribute', () => {
    const out = format('model User {\nid Int @id\n@@map("user") // table name\n}');
    expect(out).toEqual(
      lines('model User {', '  id Int @id', '  @@map("user") // table name', '}', ''),
    );
  });

  it('reattaches a trailing comment on a top-level declaration line', () => {
    const out = format('model User { // a user\nid Int @id\n}');
    expect(out).toEqual(lines('model User { // a user', '  id Int @id', '}', ''));
  });

  it('reattaches a trailing comment on a block closing brace line', () => {
    const out = format('model User {\nid Int @id\n} // end of model');
    expect(out).toEqual(lines('model User {', '  id Int @id', '} // end of model', ''));
  });

  it('reattaches a trailing comment on a nested block closing brace line', () => {
    const out = format('namespace App {\nmodel User {\nid Int @id\n} // end User\n}');
    expect(out).toEqual(
      lines('namespace App {', '  model User {', '    id Int @id', '  } // end User', '}', ''),
    );
  });
});

describe('format blank-line preservation', () => {
  it('collapses a run of blank lines between fields to one', () => {
    const out = format('model User {\nid Int @id\n\n\n\nname String\n}');
    expect(out).toEqual(lines('model User {', '  id Int @id', '', '  name String', '}', ''));
  });

  it('keeps a single blank line between a field group and a block attribute', () => {
    const out = format('model User {\nid Int @id\nname String\n\n@@map("user")\n}');
    expect(out).toEqual(
      lines('model User {', '  id   Int    @id', '  name String', '', '  @@map("user")', '}', ''),
    );
  });

  it('drops a blank line immediately after the opening brace', () => {
    const out = format('model User {\n\nid Int @id\n}');
    expect(out).toEqual(lines('model User {', '  id Int @id', '}', ''));
  });

  it('drops a blank line immediately before the closing brace', () => {
    const out = format('model User {\nid Int @id\n\n}');
    expect(out).toEqual(lines('model User {', '  id Int @id', '}', ''));
  });

  it('collapses blank lines between top-level declarations to one', () => {
    const out = format('model A {\nid Int\n}\n\n\nmodel B {\nid Int\n}');
    expect(out).toEqual(lines('model A {', '  id Int', '}', '', 'model B {', '  id Int', '}', ''));
  });
});

describe('format dangling trailing comments', () => {
  it('keeps an own-line comment after the last field at member indent before the brace', () => {
    const out = format('model User {\nid Int @id\n// trailing note\n}');
    expect(out).toEqual(lines('model User {', '  id Int @id', '  // trailing note', '}', ''));
  });

  it('keeps multiple own-line comments after the last field before the brace', () => {
    const out = format('model User {\nid Int @id\n// first\n// second\n}');
    expect(out).toEqual(
      lines('model User {', '  id Int @id', '  // first', '  // second', '}', ''),
    );
  });

  it('keeps a dangling comment in an otherwise empty block at member indent', () => {
    const out = format('model User {\n// only a comment\n}');
    expect(out).toEqual(lines('model User {', '  // only a comment', '}', ''));
  });

  it('collapses a blank-line run before a dangling comment to one and drops the trailing blank', () => {
    const out = format('model User {\nid Int @id\n\n\n// trailing note\n}');
    expect(out).toEqual(lines('model User {', '  id Int @id', '', '  // trailing note', '}', ''));
  });

  it('keeps a dangling comment at the end of the document at column zero', () => {
    const out = format('model User {\nid Int @id\n}\n// end of file');
    expect(out).toEqual(lines('model User {', '  id Int @id', '}', '// end of file', ''));
  });

  it('keeps a /// doc comment dangling before the closing brace', () => {
    const out = format('model User {\nid Int @id\n/// dangling doc\n}');
    expect(out).toEqual(lines('model User {', '  id Int @id', '  /// dangling doc', '}', ''));
  });
});

describe('format alignment grouping with trivia', () => {
  it('breaks the alignment run at a leading comment line', () => {
    const out = format('model M {\nidentifier Int @id\n// a separator\nx Int @unique\n}');
    expect(out).toEqual(
      lines('model M {', '  identifier Int @id', '  // a separator', '  x Int @unique', '}', ''),
    );
  });

  it('breaks the alignment run at a blank line', () => {
    const out = format('model M {\nidentifier Int @id\n\nx Int @unique\n}');
    expect(out).toEqual(lines('model M {', '  identifier Int @id', '', '  x Int @unique', '}', ''));
  });

  it('aligns a run of fields that carry trailing comments without disturbing the columns', () => {
    const out = format('model M {\nid Int @id // pk\nname String // label\n}');
    expect(out).toEqual(
      lines('model M {', '  id   Int    @id // pk', '  name String // label', '}', ''),
    );
  });
});
