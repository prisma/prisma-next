import type { AuthoringPslBlockDescriptorNamespace } from '@prisma-next/framework-components/authoring';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import { classifyPslCompletionContext } from '../src/completion-context';
import { providePslCompletionItems } from '../src/completion-provider';

const scalarTypes = ['String', 'Int', 'Boolean', 'DateTime'] as const;
const nameSnippetPlaceholder = '$' + '{1:Name}';

const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  policy: {
    kind: 'pslBlock',
    keyword: 'policy',
    discriminator: 'fixture-policy',
    name: { required: true },
    parameters: {
      on: { kind: 'ref', refKind: 'model', scope: 'same-space' },
      where: { kind: 'value', codecId: 'fixture/text@1' },
      mode: { kind: 'option', values: ['permissive', 'restrictive'] },
      using: { kind: 'value', codecId: 'fixture/text@1' },
    },
  },
  access: {
    audit: {
      kind: 'pslBlock',
      keyword: 'audit',
      discriminator: 'fixture-audit',
      name: { required: true },
      parameters: {
        on: { kind: 'ref', refKind: 'model', scope: 'same-space' },
      },
    },
  },
};

const candidateSource = [
  'types {',
  '  Email = String',
  '  UserId = User',
  '}',
  'model User {',
  '  id Int',
  '}',
  'type Address {',
  '  street String',
  '}',
  'policy Audit {',
  '  on = read',
  '}',
  'namespace auth {',
  '  model Account {',
  '    id Int',
  '  }',
  '  model User {',
  '    id Int',
  '  }',
  '  type Profile {',
  '    displayName String',
  '  }',
  '  policy ScopedAudit {',
  '    on = read',
  '  }',
  '}',
].join('\n');

function complete(
  markedFieldSource: string,
  options: { readonly clientSupportsSnippets?: boolean } = {},
) {
  const markedSource = `${candidateSource}\n${markedFieldSource}`;
  const cursorOffset = markedSource.indexOf('|');
  expect(cursorOffset).toBeGreaterThanOrEqual(0);
  const source = `${markedSource.slice(0, cursorOffset)}${markedSource.slice(cursorOffset + 1)}`;
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes,
    pslBlockDescriptors,
  });
  const context = classifyPslCompletionContext({
    document,
    sourceFile,
    position: sourceFile.positionAt(cursorOffset),
  });

  return {
    items: providePslCompletionItems({
      context,
      sourceFile,
      candidates: { scalarTypes, pslBlockDescriptors, symbolTable },
      clientSupportsSnippets: options.clientSupportsSnippets === true,
    }),
    sourceFile,
    cursorOffset,
  };
}

describe('providePslCompletionItems', () => {
  it('returns document-level declaration keyword candidates with stable plain-text edits', () => {
    const { items, sourceFile, cursorOffset } = complete('|');

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'type',
      'types',
      'namespace',
      'audit',
      'policy',
    ]);
    expect(items.map((item) => item.detail)).toEqual([
      'PSL declaration keyword',
      'PSL declaration keyword',
      'PSL declaration keyword',
      'PSL declaration keyword',
      'Generic block keyword',
      'Generic block keyword',
    ]);
    expect(items[0]).toMatchObject({
      kind: CompletionItemKind.Keyword,
      filterText: 'model',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'model ',
      },
    });
    expect(items[0]?.insertTextFormat).toBeUndefined();
  });

  it('filters document-level declaration keyword prefixes and replaces the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete('mo|');

    expect(items.map((item) => item.label)).toEqual(['model']);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset - 'mo'.length),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'model ',
    });
  });

  it('returns namespace-body declaration keywords without document-only native keywords', () => {
    const { items } = complete(['namespace feature {', '  |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['model', 'type', 'audit', 'policy']);
    expect(items.map((item) => item.label)).not.toContain('types');
    expect(items.map((item) => item.label)).not.toContain('namespace');
  });

  it('filters namespace-body declaration keyword prefixes', () => {
    const { items } = complete(['namespace feature {', '  po|', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['policy']);
  });

  it('returns snippet declaration keyword edits only when the client supports snippets', () => {
    const { items } = complete('|', { clientSupportsSnippets: true });

    expect(items.find((item) => item.label === 'model')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `model ${nameSnippetPlaceholder} {\n  $0\n}` },
    });
    expect(items.find((item) => item.label === 'policy')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `policy ${nameSnippetPlaceholder} {\n  $0\n}` },
    });
  });

  it('returns an empty list for ordinary model attribute contexts', () => {
    const { items } = complete(['model Post {', '  id Int', '  @@|', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('returns stable bare model field type completion candidates', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  author |', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual([
      'Boolean',
      'DateTime',
      'Int',
      'String',
      'Post',
      'User',
      'Address',
      'Email',
      'UserId',
      'auth.',
    ]);
    expect(items.map((item) => item.detail)).toEqual([
      'Configured scalar type',
      'Configured scalar type',
      'Configured scalar type',
      'Configured scalar type',
      'Model',
      'Model',
      'Composite type',
      'Scalar type',
      'Type alias',
      'Namespace',
    ]);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'Boolean',
    });
  });

  it('filters bare prefixes against visible candidate labels', () => {
    const { items } = complete(['model Post {', '  reviewer U|', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['User', 'UserId']);
  });

  it('filters bare namespace prefixes and replaces the typed segment with the namespace qualifier', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  reviewer a|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['auth.']);
    expect(items[0]).toMatchObject({
      kind: CompletionItemKind.Module,
      detail: 'Namespace',
      filterText: 'auth.',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'a'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'auth.',
      },
    });
  });

  it('returns namespace members after a namespace qualifier', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  owner auth.|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['Account', 'User', 'Profile']);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'Account',
    });
  });

  it('returns namespace-qualified candidates with replacement metadata for the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  owner auth.U|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['User']);
    expect(items[0]).toMatchObject({
      detail: 'Model in namespace auth',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'U'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'User',
      },
    });
  });

  it('returns contract-space-qualified candidates from visible namespace data', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  owner supabase:auth.P|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['Profile']);
    expect(items[0]).toMatchObject({
      detail: 'Composite type in namespace auth',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'P'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'Profile',
      },
    });
  });

  it('returns descriptor-backed generic block parameter completions', () => {
    const { items, sourceFile, cursorOffset } = complete(['policy Rule {', '  |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['on', 'where', 'mode', 'using']);
    expect(items.map((item) => item.detail)).toEqual([
      'Generic block parameter',
      'Generic block parameter',
      'Generic block parameter',
      'Generic block parameter',
    ]);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'on',
    });
  });

  it('filters descriptor-backed generic block parameters and excludes sibling keys', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['policy Rule {', '  on = User', '  wh|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['where']);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset - 'wh'.length),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'where',
    });
  });

  it('returns no generic block parameter completions without a matching descriptor', () => {
    const { items } = complete(['extension Rule {', '  |', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('returns an empty list for unsupported classifier contexts', () => {
    const { items } = complete(['model Post {', '  id Int @|', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('does not return generic block symbols as model field type candidates', () => {
    const { items } = complete(['model Post {', '  audit |', '}'].join('\n'));

    expect(items.map((item) => item.label)).not.toContain('Audit');
    expect(items.map((item) => item.label)).not.toContain('auth.ScopedAudit');
  });
});
