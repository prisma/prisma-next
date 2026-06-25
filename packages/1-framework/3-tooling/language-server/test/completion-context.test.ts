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

describe('classifyPslCompletionContext', () => {
  it('classifies a blank model field type position', () => {
    const context = classify(['model Post {', '  author |', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'modelFieldType',
      fieldName: 'author',
      prefix: { path: [], name: '' },
    });
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

  it('returns unsupported in comments and trivia outside type positions', () => {
    expect(classify(['model Post {', '  // U|', '  id Int', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'comment',
    });

    expect(classify(['model Post {', '  |', '  id Int', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'outsideModelField',
    });
  });

  it('returns unsupported for ordinary field and block attributes', () => {
    expect(classify(['model Post {', '  id Int @|', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'attribute',
    });

    expect(classify(['model Post {', '  id Int', '  @@|', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'attribute',
    });
  });

  it('returns unsupported inside attribute arguments', () => {
    expect(classify(['model Post {', '  id Int @default(|)', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'attributeArgument',
    });

    expect(
      classify(['model Post {', '  authorId Int @relation(fields: [|])', '}'].join('\n')),
    ).toMatchObject({
      kind: 'unsupported',
      reason: 'attributeArgument',
    });
  });

  it('returns unsupported inside generic block contexts', () => {
    expect(classify(['datasource db {', '  provider = |', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'genericBlock',
    });

    expect(classify(['generator client {', '  prov|', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'genericBlock',
    });
  });

  it('returns unsupported inside type constructor arguments', () => {
    expect(classify(['model Embedding {', '  vector Vector(|)', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'constructorArgument',
    });
  });

  it('returns unsupported outside model field type prefixes', () => {
    expect(classify(['model Post {', '  |id Int', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'fieldName',
    });

    expect(classify(['model Post {', '  id Int |', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'notTypePrefix',
    });
  });

  it('returns unsupported for invalid over-qualified names', () => {
    expect(classify(['model Post {', '  owner auth.domain.U|', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'invalidQualifiedType',
    });

    expect(classify(['model Post {', '  owner supabase:auth:U|', '}'].join('\n'))).toMatchObject({
      kind: 'unsupported',
      reason: 'invalidQualifiedType',
    });
  });
});
