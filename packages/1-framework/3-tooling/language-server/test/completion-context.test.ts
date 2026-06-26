import { parse } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { classifyPslCompletionContext } from '../src/completion-context';

function classify(markedSource: string): ReturnType<typeof classifyPslCompletionContext> {
  const cursorOffset = markedSource.indexOf('|');
  expect(cursorOffset).toBeGreaterThanOrEqual(0);
  const source = `${markedSource.slice(0, cursorOffset)}${markedSource.slice(cursorOffset + 1)}`;
  const { document, sourceFile } = parse(source);

  return classifyPslCompletionContext({
    document,
    sourceFile,
    position: sourceFile.positionAt(cursorOffset),
  });
}

function expectUnsupported(markedSource: string): void {
  expect(classify(markedSource)).toMatchObject({ kind: 'unsupported' });
}

describe('classifyPslCompletionContext', () => {
  it('classifies blank document-level declaration keyword positions', () => {
    const context = classify('|');

    expect(context).toMatchObject({
      kind: 'declarationKeyword',
      scope: 'document',
      prefix: '',
      replacementStartOffset: 0,
      offset: 0,
    });
  });

  it('classifies partial document-level declaration keyword prefixes', () => {
    const context = classify('mo|');

    expect(context).toMatchObject({
      kind: 'declarationKeyword',
      scope: 'document',
      prefix: 'mo',
      replacementStartOffset: 0,
      offset: 2,
    });
  });

  it('does not classify declaration keyword prefixes after other tokens on the same line', () => {
    expectUnsupported('model User {} mo|');
  });

  it('classifies blank namespace-body declaration keyword positions', () => {
    const context = classify(['namespace auth {', '  |', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'declarationKeyword',
      scope: 'namespace',
      prefix: '',
    });
  });

  it('classifies partial namespace-body declaration keyword prefixes', () => {
    const context = classify(['namespace auth {', '  ty|', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'declarationKeyword',
      scope: 'namespace',
      prefix: 'ty',
    });
  });

  it('classifies a blank model field type position', () => {
    const context = classify(['model Post {', '  author |', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'modelFieldType',
      fieldName: 'author',
      prefix: { path: [], name: '' },
    });
  });

  it('does not treat the next indented line as a blank model field type position', () => {
    expectUnsupported(['model Post {', '  author', '  |', '}'].join('\n'));
  });

  it('does not treat a comment after the field name as a blank model field type position', () => {
    expectUnsupported(['model Post {', '  author // |', '}'].join('\n'));
  });

  it('classifies a partial bare model field type prefix', () => {
    const context = classify(['model Post {', '  reviewer U|', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'modelFieldType',
      fieldName: 'reviewer',
      prefix: { path: ['U'], name: 'U' },
    });
  });

  it('classifies namespace-qualified model field type prefixes', () => {
    expect(classify(['model Post {', '  owner auth.|', '}'].join('\n'))).toMatchObject({
      kind: 'modelFieldType',
      fieldName: 'owner',
      prefix: { path: ['auth'], namespace: 'auth', name: '' },
    });

    expect(classify(['model Post {', '  editor auth.U|', '}'].join('\n'))).toMatchObject({
      kind: 'modelFieldType',
      fieldName: 'editor',
      prefix: { path: ['auth', 'U'], namespace: 'auth', name: 'U' },
    });
  });

  it('classifies contract-space-qualified model field type prefixes', () => {
    expect(classify(['model Post {', '  external supabase:|', '}'].join('\n'))).toMatchObject({
      kind: 'modelFieldType',
      fieldName: 'external',
      prefix: { path: ['supabase'], contractSpace: 'supabase', name: '' },
    });

    expect(
      classify(['model Post {', '  externalUser supabase:auth.|', '}'].join('\n')),
    ).toMatchObject({
      kind: 'modelFieldType',
      fieldName: 'externalUser',
      prefix: {
        path: ['supabase', 'auth'],
        contractSpace: 'supabase',
        namespace: 'auth',
        name: '',
      },
    });

    expect(classify(['model Post {', '  owner supabase:auth.U|', '}'].join('\n'))).toMatchObject({
      kind: 'modelFieldType',
      fieldName: 'owner',
      prefix: {
        path: ['supabase', 'auth', 'U'],
        contractSpace: 'supabase',
        namespace: 'auth',
        name: 'U',
      },
    });
  });

  it('classifies a contract-space-qualified prefix without a namespace segment', () => {
    expect(classify(['model Post {', '  external supabase:U|', '}'].join('\n'))).toMatchObject({
      kind: 'modelFieldType',
      fieldName: 'external',
      prefix: { path: ['supabase', 'U'], contractSpace: 'supabase', name: 'U' },
    });
  });

  it('truncates the cursor segment at the offset when the cursor sits mid-name', () => {
    expect(classify(['model Post {', '  owner auth.Use|r', '}'].join('\n'))).toMatchObject({
      kind: 'modelFieldType',
      fieldName: 'owner',
      prefix: { path: ['auth', 'Use'], namespace: 'auth', name: 'Use' },
    });
  });

  it('returns unsupported in comments and trivia outside type positions', () => {
    expectUnsupported(['model Post {', '  // U|', '  id Int', '}'].join('\n'));
    expectUnsupported(['model Post {', '  |', '  id Int', '}'].join('\n'));
  });

  it('returns unsupported for ordinary field and block attributes', () => {
    expectUnsupported(['model Post {', '  id Int @|', '}'].join('\n'));
    expectUnsupported(['model Post {', '  id Int', '  @@|', '}'].join('\n'));
  });

  it('returns unsupported inside attribute arguments', () => {
    expectUnsupported(['model Post {', '  id Int @default(|)', '}'].join('\n'));
    expectUnsupported(['model Post {', '  authorId Int @relation(fields: [|])', '}'].join('\n'));
  });

  it('classifies blank generic block parameter positions', () => {
    expect(classify(['policy UserAccess {', '  |', '}'].join('\n'))).toMatchObject({
      kind: 'genericBlockParameter',
      blockKeyword: 'policy',
      prefix: '',
      existingParameterNames: [],
    });
  });

  it('classifies generic block parameter prefixes and records sibling keys', () => {
    expect(classify(['policy UserAccess {', '  on = User', '  wh|', '}'].join('\n'))).toMatchObject(
      {
        kind: 'genericBlockParameter',
        blockKeyword: 'policy',
        prefix: 'wh',
        existingParameterNames: ['on'],
      },
    );
  });

  it('returns unsupported inside generic block parameter values', () => {
    expectUnsupported(['datasource db {', '  provider = |', '}'].join('\n'));
  });

  it('classifies the gap before = as a generic block parameter with an empty source range', () => {
    const context = classify(['datasource db {', '  url |= "x"', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'genericBlockParameter',
      blockKeyword: 'datasource',
      prefix: '',
    });
    // rust-analyzer `source_range()` shape: the cursor sits in whitespace, so the
    // edit range is empty at the cursor rather than synthesising the `url` key.
    if (context.kind === 'genericBlockParameter') {
      expect(context.replacementStartOffset).toBe(context.offset);
    }
  });

  it('returns unsupported inside type constructor arguments', () => {
    expectUnsupported(['model Embedding {', '  vector Vector(|)', '}'].join('\n'));
  });

  it('returns unsupported outside model field type prefixes', () => {
    expectUnsupported(['model Post {', '  |id Int', '}'].join('\n'));
    expectUnsupported(['model Post {', '  id Int |', '}'].join('\n'));
  });

  it('returns unsupported for invalid over-qualified names', () => {
    expectUnsupported(['model Post {', '  owner auth.domain.U|', '}'].join('\n'));
    expectUnsupported(['model Post {', '  owner supabase:auth:U|', '}'].join('\n'));
  });
});
