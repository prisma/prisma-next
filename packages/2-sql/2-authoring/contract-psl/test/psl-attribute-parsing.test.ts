import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { PslSpan } from '@prisma-next/psl-parser';
import { parse, type ResolvedAttribute, resolve } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import {
  getAttribute,
  getNamedArgument,
  getPositionalArgumentExpr,
  getPositionalArguments,
  parseAttributeFieldList,
  parseConstraintMapArgument,
  parseControlPolicyAttribute,
  parseFieldList,
  parseMapName,
  parseObjectLiteralStringMap,
  parseOptionalNumericArguments,
  parseOptionalSingleIntegerArgument,
} from '../src/psl-attribute-parsing';
import { sqlScalarTypes } from './fixtures';

const span: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 1, line: 1, column: 2 },
};

function modelAttribute(schema: string, model: string, attribute: string): ResolvedAttribute {
  const { document, sourceFile } = parse(schema);
  const resolved = resolve(document, sourceFile, {
    scalarTypes: sqlScalarTypes,
    defaultNamespaceId: 'public',
  });
  const ns = [...resolved.namespaces.values()][0];
  const target = ns?.models.get(model);
  const found = target?.attributes.find((attr) => attr.name === attribute);
  if (!found) throw new Error(`attribute @@${attribute} not found on ${model}`);
  return found;
}

function fieldAttribute(
  schema: string,
  model: string,
  field: string,
  attribute: string,
): ResolvedAttribute {
  const { document, sourceFile } = parse(schema);
  const resolved = resolve(document, sourceFile, {
    scalarTypes: sqlScalarTypes,
    defaultNamespaceId: 'public',
  });
  const ns = [...resolved.namespaces.values()][0];
  const target = ns?.models.get(model)?.fields.get(field);
  const found = target?.attributes.find((attr) => attr.name === attribute);
  if (!found) throw new Error(`attribute @${attribute} not found on ${model}.${field}`);
  return found;
}

function callParse(raw: string): {
  result: Record<string, string> | undefined;
  diagnostics: ContractSourceDiagnostic[];
} {
  const diagnostics: ContractSourceDiagnostic[] = [];
  const result = parseObjectLiteralStringMap({
    raw,
    diagnostics,
    sourceId: 'schema.prisma',
    span,
    entityLabel: 'model User @@index',
  });
  return { result, diagnostics };
}

describe('parseObjectLiteralStringMap', () => {
  it('parses a single-key object literal', () => {
    const { result, diagnostics } = callParse('{ tokenizer: "ngram" }');
    expect(result).toEqual({ tokenizer: 'ngram' });
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a multi-key object literal', () => {
    const { result, diagnostics } = callParse('{ a: "one", b: "two", c: "three" }');
    expect(result).toEqual({ a: 'one', b: 'two', c: 'three' });
    expect(diagnostics).toHaveLength(0);
  });

  it('returns an empty record for an empty object literal', () => {
    const { result, diagnostics } = callParse('{}');
    expect(result).toEqual({});
    expect(diagnostics).toHaveLength(0);
  });

  it('returns an empty record when only whitespace inside the braces', () => {
    const { result, diagnostics } = callParse('{   }');
    expect(result).toEqual({});
    expect(diagnostics).toHaveLength(0);
  });

  it('tolerates a trailing comma', () => {
    const { result, diagnostics } = callParse('{ a: "1", b: "2", }');
    expect(result).toEqual({ a: '1', b: '2' });
    expect(diagnostics).toHaveLength(0);
  });

  it('preserves commas that appear inside quoted values', () => {
    const { result, diagnostics } = callParse('{ list: "a,b,c" }');
    expect(result).toEqual({ list: 'a,b,c' });
    expect(diagnostics).toHaveLength(0);
  });

  it('preserves colons that appear inside quoted keys-or-values', () => {
    const { result, diagnostics } = callParse('{ url: "https://example.com" }');
    expect(result).toEqual({ url: 'https://example.com' });
    expect(diagnostics).toHaveLength(0);
  });

  it('tracks bracket depth when separating entries', () => {
    const { result, diagnostics } = callParse('{ list: "[a,b]", other: "x" }');
    expect(result).toEqual({ list: '[a,b]', other: 'x' });
    expect(diagnostics).toHaveLength(0);
  });

  it('handles escaped quotes inside string values', () => {
    const { result, diagnostics } = callParse('{ s: "hello \\"world\\"" }');
    expect(result).toEqual({ s: 'hello "world"' });
    expect(diagnostics).toHaveLength(0);
  });

  it('rejects input that does not start with {', () => {
    const { result, diagnostics } = callParse('key: "value" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_ARGUMENT');
    expect(diagnostics[0]?.message).toMatch(/object literal/);
  });

  it('rejects input that does not end with }', () => {
    const { result, diagnostics } = callParse('{ key: "value"');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_ARGUMENT');
  });

  it('rejects an entry that is missing a colon', () => {
    const { result, diagnostics } = callParse('{ noColonHere }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/colon/);
  });

  it('rejects an entry whose key is empty', () => {
    const { result, diagnostics } = callParse('{ : "value" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/bare identifier/);
  });

  it('rejects an entry whose key starts with a digit', () => {
    const { result, diagnostics } = callParse('{ 1abc: "value" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/bare identifier/);
  });

  it('rejects an entry whose key contains punctuation', () => {
    const { result, diagnostics } = callParse('{ "quoted-key": "value" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/bare identifier/);
  });

  it('rejects a boolean leaf value', () => {
    const { result, diagnostics } = callParse('{ enabled: true }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/quoted string literal/);
  });

  it('rejects a numeric leaf value', () => {
    const { result, diagnostics } = callParse('{ count: 42 }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/quoted string literal/);
  });

  it('rejects a bare identifier leaf value', () => {
    const { result, diagnostics } = callParse('{ ref: someName }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/quoted string literal/);
  });

  it('rejects duplicate keys', () => {
    const { result, diagnostics } = callParse('{ a: "1", a: "2" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/more than once/);
  });

  it('stops at the first diagnostic', () => {
    const { result, diagnostics } = callParse('{ 1bad: "x", 2bad: "y" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });
});

describe('getAttribute', () => {
  const mapAttr = fieldAttribute(`model User { id Int @id @map("user_id") }`, 'User', 'id', 'map');

  it('finds an attribute by name', () => {
    expect(getAttribute([mapAttr], 'map')?.name).toBe('map');
  });

  it('returns undefined when the attribute is absent', () => {
    expect(getAttribute([mapAttr], 'unique')).toBeUndefined();
  });
});

describe('getNamedArgument over CST', () => {
  it('returns the raw quoted text of a named argument', () => {
    const attr = fieldAttribute(
      `model Post {
        id Int @id
        authorId Int
        author User @relation(name: "PostAuthor", fields: [authorId], references: [id])
      }
      model User { id Int @id }`,
      'Post',
      'author',
      'relation',
    );
    expect(getNamedArgument(attr, 'name')).toBe('"PostAuthor"');
  });

  it('returns undefined for an absent named argument', () => {
    const attr = fieldAttribute(`model User { id Int @id @map("user_id") }`, 'User', 'id', 'map');
    expect(getNamedArgument(attr, 'map')).toBeUndefined();
  });
});

describe('getPositionalArguments / getPositionalArgumentExpr over CST', () => {
  it('reads positional args as raw source text', () => {
    const attr = fieldAttribute(
      'model User { id String @id @db.VarChar(255) }',
      'User',
      'id',
      'db.VarChar',
    );
    expect(getPositionalArguments(attr)).toEqual(['255']);
    const first = getPositionalArgumentExpr(attr);
    expect(first?.syntax.kind).toBe('NumberLiteralExpr');
  });
});

describe('parseFieldList over CST', () => {
  it('reads bare field names from an array-literal expression', () => {
    const attr = modelAttribute(
      `model User {
        firstName String
        lastName String
        @@id([firstName, lastName])
      }`,
      'User',
      'id',
    );
    const arg = getPositionalArgumentExpr(attr)!;
    expect(parseFieldList(arg)).toEqual(['firstName', 'lastName']);
  });

  it('returns undefined when the argument is not an array literal', () => {
    const attr = fieldAttribute(`model User { id Int @id @map("user_id") }`, 'User', 'id', 'map');
    const arg = getPositionalArgumentExpr(attr)!;
    expect(parseFieldList(arg)).toBeUndefined();
  });
});

describe('parseMapName over CST', () => {
  it('reads the quoted positional map name', () => {
    const attr = fieldAttribute(`model User { id Int @id @map("user_id") }`, 'User', 'id', 'map');
    const diagnostics: ContractSourceDiagnostic[] = [];
    const result = parseMapName({
      attribute: attr,
      defaultValue: 'id',
      sourceId: 'schema.prisma',
      diagnostics,
      entityLabel: 'model User field id',
      span,
    });
    expect(result).toBe('user_id');
    expect(diagnostics).toHaveLength(0);
  });

  it('returns the default and diagnoses when the value is not a quoted string', () => {
    const attr = fieldAttribute('model User { id Int @id @map(user_id) }', 'User', 'id', 'map');
    const diagnostics: ContractSourceDiagnostic[] = [];
    const result = parseMapName({
      attribute: attr,
      defaultValue: 'id',
      sourceId: 'schema.prisma',
      diagnostics,
      entityLabel: 'model User field id',
      span,
    });
    expect(result).toBe('id');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toBe(
      'model User field id @map requires a positional quoted string literal argument',
    );
  });
});

describe('parseConstraintMapArgument over CST', () => {
  it('reads a quoted named map argument', () => {
    const attr = modelAttribute(
      `model User {
        id Int @id
        email String
        @@unique([email], map: "user_email_key")
      }`,
      'User',
      'unique',
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const result = parseConstraintMapArgument({
      attribute: attr,
      sourceId: 'schema.prisma',
      diagnostics,
      entityLabel: 'model User @@unique',
      span,
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
    });
    expect(result).toBe('user_email_key');
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseAttributeFieldList over CST', () => {
  it('reads the named fields list', () => {
    const attr = modelAttribute(
      `model User {
        id Int @id
        a String
        b String
        @@unique(fields: [a, b])
      }`,
      'User',
      'unique',
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const result = parseAttributeFieldList({
      attribute: attr,
      sourceId: 'schema.prisma',
      diagnostics,
      span,
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      entityLabel: 'model User @@unique',
    });
    expect(result).toEqual(['a', 'b']);
    expect(diagnostics).toHaveLength(0);
  });

  it('diagnoses a missing field list', () => {
    const attr = modelAttribute(
      `model User {
        id Int @id
        @@unique()
      }`,
      'User',
      'unique',
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const result = parseAttributeFieldList({
      attribute: attr,
      sourceId: 'schema.prisma',
      diagnostics,
      span,
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      entityLabel: 'model User @@unique',
    });
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toBe('model User @@unique requires fields list argument');
  });
});

describe('parseControlPolicyAttribute over CST', () => {
  it('reads a known policy literal', () => {
    const attr = modelAttribute(
      `model User {
        id Int @id
        @@control(external)
      }`,
      'User',
      'control',
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const result = parseControlPolicyAttribute({
      attribute: attr,
      sourceId: 'schema.prisma',
      diagnostics,
      span,
    });
    expect(result).toBe('external');
    expect(diagnostics).toHaveLength(0);
  });

  it('diagnoses an unknown policy verbatim', () => {
    const attr = modelAttribute(
      `model User {
        id Int @id
        @@control(bogus)
      }`,
      'User',
      'control',
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const result = parseControlPolicyAttribute({
      attribute: attr,
      sourceId: 'schema.prisma',
      diagnostics,
      span,
    });
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toBe(
      '`@@control` argument `bogus` is not a known policy. Allowed: `managed`, `tolerated`, `external`, `observed`.',
    );
  });
});

describe('parseOptionalSingleIntegerArgument over CST', () => {
  it('reads a single positional integer', () => {
    const attr = fieldAttribute(
      'model User { id String @id @db.VarChar(255) }',
      'User',
      'id',
      'db.VarChar',
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const result = parseOptionalSingleIntegerArgument({
      attribute: attr,
      diagnostics,
      sourceId: 'schema.prisma',
      span,
      entityLabel: 'model User field id',
      minimum: 1,
      valueLabel: 'positive integer length',
    });
    expect(result).toBe(255);
    expect(diagnostics).toHaveLength(0);
  });

  it('returns null when no positional argument is present', () => {
    const attr = fieldAttribute('model User { id String @id @db.Text }', 'User', 'id', 'db.Text');
    const diagnostics: ContractSourceDiagnostic[] = [];
    const result = parseOptionalSingleIntegerArgument({
      attribute: attr,
      diagnostics,
      sourceId: 'schema.prisma',
      span,
      entityLabel: 'model User field id',
      minimum: 1,
      valueLabel: 'positive integer length',
    });
    expect(result).toBeNull();
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseOptionalNumericArguments over CST', () => {
  it('reads precision and scale', () => {
    const attr = fieldAttribute(
      'model Price { id Int @id amount Decimal @db.Decimal(10, 2) }',
      'Price',
      'amount',
      'db.Decimal',
    );
    const diagnostics: ContractSourceDiagnostic[] = [];
    const result = parseOptionalNumericArguments({
      attribute: attr,
      diagnostics,
      sourceId: 'schema.prisma',
      span,
      entityLabel: 'model Price field amount',
    });
    expect(result).toEqual({ precision: 10, scale: 2 });
    expect(diagnostics).toHaveLength(0);
  });
});
