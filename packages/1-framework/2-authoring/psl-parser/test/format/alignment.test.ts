import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

describe('format per-block field alignment', () => {
  it('starts every type at one column past the widest field name in the block', () => {
    const out = format('model User {\nid Int @id\nemail Email @unique\n}');
    expect(out).toEqual(
      ['model User {', '  id    Int   @id', '  email Email @unique', '}', ''].join('\n'),
    );
  });

  it('aligns trailing attributes to one column past the widest name+type cell', () => {
    const out = format('model User {\nid ObjectId @id\nname String\nemail String @unique\n}');
    expect(out).toEqual(
      [
        'model User {',
        '  id    ObjectId @id',
        '  name  String',
        '  email String   @unique',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('leaves a field with no attributes ending immediately after its type', () => {
    const out = format('model M {\nidentifier Int @id\nname String\n}');
    expect(out).toEqual(
      ['model M {', '  identifier Int    @id', '  name       String', '}', ''].join('\n'),
    );
  });

  it('aligns composite type fields the same way as model fields', () => {
    const out = format('type Address {\nstreetAndNumber String\ncity String\n}');
    expect(out).toEqual(
      ['type Address {', '  streetAndNumber String', '  city            String', '}', ''].join(
        '\n',
      ),
    );
  });

  it('renders enum members as bare keys with no alignment padding', () => {
    const out = format('enum Role {\nUSER\nADMINISTRATOR\nGUEST\n}');
    expect(out).toEqual(
      ['enum Role {', '  USER', '  ADMINISTRATOR', '  GUEST', '}', ''].join('\n'),
    );
  });

  it('computes widths independently for each block in the document', () => {
    const out = format(
      'model A {\nshortName Int @id\nx Int\n}\nmodel B {\nid Int @id\nverboseColumn Int\n}',
    );
    expect(out).toEqual(
      [
        'model A {',
        '  shortName Int @id',
        '  x         Int',
        '}',
        'model B {',
        '  id            Int @id',
        '  verboseColumn Int',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('aligns the attribute column past a wide type even when the widest type has no attribute', () => {
    const out = format('model M {\nid Int @id\nrelated SomeVeryLongTypeName\n}');
    expect(out).toEqual(
      [
        'model M {',
        '  id      Int                  @id',
        '  related SomeVeryLongTypeName',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('aligns multiple trailing attributes as a single right-hand cell', () => {
    const out = format('model M {\nid Int @id @default(autoincrement())\nname String\n}');
    expect(out).toEqual(
      ['model M {', '  id   Int    @id @default(autoincrement())', '  name String', '}', ''].join(
        '\n',
      ),
    );
  });

  it('round-trips an already-aligned comment-free multi-block schema unchanged', () => {
    const schema = [
      'model User {',
      '  id      ObjectId @id',
      '  name    String',
      '  email   String   @unique',
      '  address Address?',
      '}',
      'type Address {',
      '  streetAndNumber String',
      '  city            String',
      '  postalCode      String',
      '}',
      'enum Role {',
      '  USER',
      '  ADMINISTRATOR',
      '}',
      '',
    ].join('\n');
    expect(format(schema)).toEqual(schema);
  });

  it('idempotently formats unaligned input', () => {
    const once = format('model User {\nid Int @id\nemail Email @unique\n}');
    expect(format(once)).toEqual(once);
  });
});
