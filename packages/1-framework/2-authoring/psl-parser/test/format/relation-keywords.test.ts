import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

const model = (...lines: string[]): string =>
  ['model Post {', ...lines.map((line) => `  ${line}`), '}', ''].join('\n');

// The emitter hugs `[` to the colon (`from:[a]`) and keeps a space before a
// bare value (`from: a`); the rename touches the keyword token only, so these
// expectations carry the emitter's own spacing, not the input's.
describe('format canonicalises @relation FK keywords', () => {
  it('rewrites fields/references to from/to', () => {
    const input = model(
      'id     Int  @id',
      'userId Int',
      'user   User @relation(fields: [userId], references: [id])',
    );
    expect(format(input)).toEqual(
      model('id     Int  @id', 'userId Int', 'user   User @relation(from:[userId], to:[id])'),
    );
  });

  it('rewrites a bare single-field argument', () => {
    const input = model('userId Int', 'user User @relation(fields: userId, references: id)');
    expect(format(input)).toContain('@relation(from: userId, to: id)');
  });

  it('preserves a trailing comment on the relation line', () => {
    const input = model('user User @relation(fields: [userId], references: [id]) // owner');
    const out = format(input);
    expect(out).toContain('@relation(from:[userId], to:[id]) // owner');
  });

  it('preserves composite bracketed arguments and their order', () => {
    const input = model(
      'user User @relation(fields: [tenantId, userId], references: [tenant, id])',
    );
    expect(format(input)).toContain('@relation(from:[tenantId, userId], to:[tenant, id])');
  });

  it('leaves an already-canonical relation untouched', () => {
    const input = model('user User @relation(from: userId, to: id)');
    expect(format(input)).toContain('@relation(from: userId, to: id)');
  });

  it('leaves the @relation(name:) argument untouched alongside a renamed key', () => {
    const input = model('user User @relation(name: "author", fields: [userId], references: [id])');
    expect(format(input)).toContain('@relation(name: "author", from:[userId], to:[id])');
  });

  it('does not rename matching identifiers outside @relation argument keys', () => {
    const input = model('fields String', 'references String @map("references")');
    const out = format(input);
    expect(out).toContain('fields     String');
    expect(out).toContain('references String @map("references")');
  });

  it('only touches @relation, not other attributes carrying a fields argument', () => {
    const input = model('id Int @id', 'name String', '@@index(fields: [name])');
    const out = format(input);
    expect(out).toContain('@@index(fields:[name])');
  });

  it('rewrites a block-level @@relation argument key', () => {
    const input = model(
      'userId Int',
      'user   User',
      '@@relation(fields: [userId], references: [id])',
    );
    expect(format(input)).toContain('@@relation(from:[userId], to:[id])');
  });

  it('is idempotent over a schema mixing legacy, canonical, and commented relations', () => {
    const input = [
      'model Post {',
      '  id       Int   @id',
      '  authorId Int',
      '  author   User  @relation(fields: [authorId], references: [id]) // legacy',
      '  editorId Int',
      '  editor   User  @relation(from: editorId, to: id) // already canonical',
      '}',
      '',
    ].join('\n');
    const once = format(input);
    expect(format(once)).toEqual(once);
    expect(once).toContain('@relation(from:[authorId], to:[id]) // legacy');
    expect(once).toContain('@relation(from: editorId, to: id) // already canonical');
  });
});
