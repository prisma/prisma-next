import { buildSymbolTable, type SymbolTable } from '@prisma-next/psl-parser';
import { type DocumentAst, parse, SourceFile } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import {
  collectSemanticTokens,
  collectSemanticTokensInRange,
  encodeSemanticTokens,
  type SemanticTokenModifier,
  type SemanticTokenRange,
  type SemanticTokenType,
  semanticTokenModifiers,
  semanticTokensLegend,
  semanticTokenTypes,
} from '../src/semantic-tokens';

const scalarTypes = ['String', 'Int', 'Boolean', 'DateTime', 'Float', 'Json'] as const;

interface ParsedSemanticTokenSource {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly symbolTable: SymbolTable;
  readonly scalarTypes: readonly string[];
}

interface TokenDetails {
  readonly text: string;
  readonly tokenType: SemanticTokenType;
  readonly modifiers: readonly SemanticTokenModifier[];
  readonly line: number;
  readonly character: number;
}

function parseSemanticTokenSource(source: string): ParsedSemanticTokenSource {
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes,
    pslBlockDescriptors: {},
  });
  return { document, sourceFile, symbolTable, scalarTypes };
}

function describeToken(sourceFile: SourceFile, token: SemanticTokenRange): TokenDetails {
  const start = sourceFile.positionAt(token.startOffset);
  return {
    text: sourceFile.text.slice(token.startOffset, token.endOffset),
    tokenType: token.tokenType,
    modifiers: token.modifiers ?? [],
    line: start.line,
    character: start.character,
  };
}

function collectDetails(source: ParsedSemanticTokenSource): readonly TokenDetails[] {
  return collectSemanticTokens(source).map((token) => describeToken(source.sourceFile, token));
}

function findToken(
  details: readonly TokenDetails[],
  expected: Pick<TokenDetails, 'text' | 'tokenType'> & {
    readonly modifiers?: readonly SemanticTokenModifier[];
  },
): TokenDetails | undefined {
  return details.find(
    (token) =>
      token.text === expected.text &&
      token.tokenType === expected.tokenType &&
      (expected.modifiers === undefined || sameModifiers(token.modifiers, expected.modifiers)),
  );
}

function sameModifiers(
  actual: readonly SemanticTokenModifier[],
  expected: readonly SemanticTokenModifier[],
): boolean {
  if (actual.length !== expected.length) return false;
  return expected.every((modifier) => actual.includes(modifier));
}

describe('semantic token substrate', () => {
  it('keeps the semantic token legend stable', () => {
    expect(semanticTokenTypes).toEqual([
      'keyword',
      'namespace',
      'class',
      'struct',
      'type',
      'property',
      'decorator',
      'string',
      'number',
      'comment',
    ]);
    expect(semanticTokenModifiers).toEqual(['declaration', 'defaultLibrary']);
    expect(semanticTokensLegend).toEqual({
      tokenTypes: [...semanticTokenTypes],
      tokenModifiers: [...semanticTokenModifiers],
    });
  });

  it('classifies a representative document from parser artifacts', () => {
    const source = parseSemanticTokenSource(
      [
        '// leading comment',
        'namespace billing {',
        '  model Invoice {',
        '    id Int @id',
        '    customer User? @relation(name: "invoice_user", fields: [id])',
        '    amount Decimal @default(12.5)',
        '    active Boolean @default(true)',
        '    metadata Json @db.Json',
        '    shipping Address',
        '    @@map("invoices")',
        '  }',
        '',
        '  type Address {',
        '    street String',
        '  }',
        '',
        '  policy InvoiceAccess {',
        '    target = Invoice',
        '    active = true',
        '    retries = 3',
        '    label = "default"',
        '    nested = { mode: read, ttl: 30 }',
        '  }',
        '}',
        '',
        'model User {',
        '  id Int @id',
        '}',
        '',
        'types {',
        '  Decimal = Float',
        '  Identifier = String @map("id")',
        '}',
      ].join('\n'),
    );

    const details = collectDetails(source);

    expect(findToken(details, { text: '// leading comment', tokenType: 'comment' })).toBeDefined();
    expect(findToken(details, { text: 'namespace', tokenType: 'keyword' })).toBeDefined();
    expect(
      findToken(details, {
        text: 'billing',
        tokenType: 'namespace',
        modifiers: ['declaration'],
      }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'Invoice', tokenType: 'class', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'User', tokenType: 'class', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(findToken(details, { text: 'User', tokenType: 'class' })).toBeDefined();
    expect(
      findToken(details, { text: 'Address', tokenType: 'struct', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(findToken(details, { text: 'Address', tokenType: 'struct' })).toBeDefined();
    expect(
      findToken(details, { text: 'InvoiceAccess', tokenType: 'type', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'Decimal', tokenType: 'type', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'Decimal', tokenType: 'type', modifiers: ['defaultLibrary'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'String', tokenType: 'type', modifiers: ['defaultLibrary'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'Int', tokenType: 'type', modifiers: ['defaultLibrary'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'Boolean', tokenType: 'type', modifiers: ['defaultLibrary'] }),
    ).toBeDefined();
    expect(findToken(details, { text: 'id', tokenType: 'property' })).toBeDefined();
    expect(findToken(details, { text: 'customer', tokenType: 'property' })).toBeDefined();
    expect(findToken(details, { text: 'target', tokenType: 'property' })).toBeDefined();
    expect(findToken(details, { text: 'mode', tokenType: 'property' })).toBeDefined();
    expect(findToken(details, { text: 'ttl', tokenType: 'property' })).toBeDefined();
    expect(findToken(details, { text: '@relation', tokenType: 'decorator' })).toBeDefined();
    expect(findToken(details, { text: '@@map', tokenType: 'decorator' })).toBeDefined();
    expect(findToken(details, { text: '"invoice_user"', tokenType: 'string' })).toBeDefined();
    expect(findToken(details, { text: '"default"', tokenType: 'string' })).toBeDefined();
    expect(findToken(details, { text: '12.5', tokenType: 'number' })).toBeDefined();
    expect(findToken(details, { text: '30', tokenType: 'number' })).toBeDefined();
    expect(findToken(details, { text: 'true', tokenType: 'keyword' })).toBeDefined();
  });

  it('filters collected tokens to an intersecting source range', () => {
    const source = parseSemanticTokenSource(
      ['model User {', '  id Int @id', '}', '', 'type Address {', '  street String', '}'].join(
        '\n',
      ),
    );

    const tokens = collectSemanticTokensInRange(source, {
      start: { line: 0, character: 0 },
      end: { line: 3, character: 0 },
    });
    const details = tokens.map((token) => describeToken(source.sourceFile, token));
    const encoded = encodeSemanticTokens(source.sourceFile, tokens);

    expect(details.map((token) => token.text)).toEqual(['model', 'User', 'id', 'Int', '@id']);
    expect(encoded.data.length % 5).toBe(0);
    for (let index = 0; index < encoded.data.length; index += 5) {
      expect(encoded.data[index]).toBeGreaterThanOrEqual(0);
      expect(encoded.data[index + 1]).toBeGreaterThanOrEqual(0);
      expect(encoded.data[index + 2]).toBeGreaterThan(0);
    }
  });

  it('encodes sorted LSP five-integer token data', () => {
    const sourceFile = new SourceFile('aaa bbb\ncc');
    const tokens: readonly SemanticTokenRange[] = [
      { startOffset: 8, endOffset: 10, tokenType: 'type', modifiers: ['defaultLibrary'] },
      { startOffset: 4, endOffset: 7, tokenType: 'class', modifiers: ['declaration'] },
      { startOffset: 0, endOffset: 3, tokenType: 'keyword' },
    ];

    expect(encodeSemanticTokens(sourceFile, tokens)).toEqual({
      data: [0, 0, 3, 0, 0, 0, 4, 3, 2, 1, 1, 0, 2, 4, 2],
    });
  });

  it('splits multiline ranges before encoding', () => {
    const sourceFile = new SourceFile('aa\nbbb\ncc');
    const tokens: readonly SemanticTokenRange[] = [
      { startOffset: 0, endOffset: sourceFile.length, tokenType: 'comment' },
    ];

    expect(encodeSemanticTokens(sourceFile, tokens)).toEqual({
      data: [0, 0, 2, 9, 0, 1, 0, 3, 9, 0, 1, 0, 2, 9, 0],
    });
  });

  it('resolves exact duplicates before encoding', () => {
    const sourceFile = new SourceFile('aaa');
    const duplicate: SemanticTokenRange = { startOffset: 0, endOffset: 3, tokenType: 'keyword' };

    expect(encodeSemanticTokens(sourceFile, [duplicate, duplicate])).toEqual({
      data: [0, 0, 3, 0, 0],
    });
  });

  it('combines modifier bitsets deterministically', () => {
    const sourceFile = new SourceFile('Scalar');
    const tokens: readonly SemanticTokenRange[] = [
      {
        startOffset: 0,
        endOffset: 6,
        tokenType: 'type',
        modifiers: ['declaration', 'defaultLibrary'],
      },
    ];

    expect(encodeSemanticTokens(sourceFile, tokens)).toEqual({ data: [0, 0, 6, 4, 3] });
  });

  it('returns deterministic output for identical artifacts', () => {
    const sourceText = ['model User {', '  id Int @id', '  name String', '}'].join('\n');
    const first = parseSemanticTokenSource(sourceText);
    const second = parseSemanticTokenSource(sourceText);

    expect(collectSemanticTokens(first)).toEqual(collectSemanticTokens(second));
    expect(encodeSemanticTokens(first.sourceFile, collectSemanticTokens(first))).toEqual(
      encodeSemanticTokens(second.sourceFile, collectSemanticTokens(second)),
    );
  });

  it('recovers semantic tokens from malformed input', () => {
    const source = parseSemanticTokenSource(
      [
        '// recoverable comment',
        'model User {',
        '  id Int @id',
        '  name String @default("anonymous"',
        '  active Boolean @default(true)',
      ].join('\n'),
    );

    expect(() => collectSemanticTokens(source)).not.toThrow();
    const details = collectDetails(source);

    expect(
      findToken(details, { text: '// recoverable comment', tokenType: 'comment' }),
    ).toBeDefined();
    expect(findToken(details, { text: 'model', tokenType: 'keyword' })).toBeDefined();
    expect(
      findToken(details, { text: 'User', tokenType: 'class', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(findToken(details, { text: '@id', tokenType: 'decorator' })).toBeDefined();
    expect(findToken(details, { text: '"anonymous"', tokenType: 'string' })).toBeDefined();
    expect(findToken(details, { text: 'true', tokenType: 'keyword' })).toBeDefined();
  });
});
