import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type {
  AuthoringEntityContext,
  PslExtensionBlock,
} from '@prisma-next/framework-components/authoring';
import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import type { DocumentAst, GenericBlockDeclarationAst } from '@prisma-next/psl-parser/syntax';
import { parse } from '@prisma-next/psl-parser/syntax';
import type { EnumTypeHandle } from '@prisma-next/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import { reconstructExtensionBlock } from '../src/enum-block';
import { testEnumEntityContributions } from './fixtures';

const textCodec: Codec = {
  id: 'pg/text@1',
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

const codecLookup: CodecLookup = {
  get: (id) => (id === 'pg/text@1' ? textCodec : undefined),
  targetTypesFor: (id) => (id === 'pg/text@1' ? ['text'] : undefined),
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

function firstGenericBlock(document: DocumentAst): GenericBlockDeclarationAst {
  for (const declaration of document.declarations()) {
    if ('entries' in declaration) {
      return declaration as GenericBlockDeclarationAst;
    }
  }
  throw new Error('expected a generic block declaration');
}

function reconstructWithDiagnostics(schema: string): {
  block: PslExtensionBlock;
  diagnostics: ContractSourceDiagnostic[];
} {
  const { document, sourceFile } = parse(schema);
  const node = firstGenericBlock(document);
  const diagnostics: ContractSourceDiagnostic[] = [];
  const block = reconstructExtensionBlock(node, sourceFile, diagnostics, 'schema.prisma');
  return { block, diagnostics };
}

function reconstruct(schema: string): PslExtensionBlock {
  return reconstructWithDiagnostics(schema).block;
}

function runFactory(block: PslExtensionBlock): {
  handle: EnumTypeHandle | undefined;
  diagnostics: { code: string; message: string }[];
} {
  const diagnostics: { code: string; message: string }[] = [];
  const ctx: AuthoringEntityContext = {
    family: 'sql',
    target: 'postgres',
    sourceId: 'schema.prisma',
    codecLookup,
    diagnostics: { push: (d) => diagnostics.push(d) },
  };
  const handle = testEnumEntityContributions.enum.output.factory(block, ctx);
  return { handle, diagnostics };
}

describe('reconstructExtensionBlock — shape parity with the enum factory read-set', () => {
  it('surfaces the block name', () => {
    const block = reconstruct('enum Role {\n  @@type("pg/text@1")\n  Low\n}');
    expect(block.name).toBe('Role');
  });

  it('surfaces @@type as a block attribute with the codec-id arg verbatim', () => {
    const block = reconstruct('enum Role {\n  @@type("pg/text@1")\n  Low\n}');
    const typeAttr = block.blockAttributes.find((a) => a.name === 'type');
    expect(typeAttr).toBeDefined();
    expect(typeAttr?.args[0]?.value).toBe('"pg/text@1"');
  });

  it('reconstructs a bare member as a bare parameter', () => {
    const block = reconstruct('enum Role {\n  @@type("pg/text@1")\n  Low\n}');
    expect(block.parameters['Low']).toMatchObject({ kind: 'bare' });
  });

  it('reconstructs a valued member as a value parameter with JSON-quoted raw', () => {
    const block = reconstruct('enum Role {\n  @@type("pg/text@1")\n  High = "high"\n}');
    expect(block.parameters['High']).toMatchObject({ kind: 'value', raw: '"high"' });
  });

  it('reconstructs a mix of bare and valued members in order', () => {
    const block = reconstruct(
      'enum Role {\n  @@type("pg/text@1")\n  Low\n  Mid = "middle"\n  High\n}',
    );
    expect(Object.keys(block.parameters)).toEqual(['Low', 'Mid', 'High']);
    expect(block.parameters['Low']).toMatchObject({ kind: 'bare' });
    expect(block.parameters['Mid']).toMatchObject({ kind: 'value', raw: '"middle"' });
    expect(block.parameters['High']).toMatchObject({ kind: 'bare' });
  });

  it('carries a span on the block, the block attribute, and each member', () => {
    const block = reconstruct('enum Role {\n  @@type("pg/text@1")\n  Low\n  High = "high"\n}');
    expect(block.span.start.line).toBeGreaterThan(0);
    expect(block.blockAttributes[0]?.span.start.line).toBeGreaterThan(0);
    expect(block.parameters['Low']?.span.start.line).toBeGreaterThan(0);
    expect(block.parameters['High']?.span.start.line).toBeGreaterThan(0);
  });

  it('emits PSL_EXTENSION_DUPLICATE_PARAMETER for a duplicate member, keeping the first', () => {
    const { block, diagnostics } = reconstructWithDiagnostics(
      'enum Priority {\n  @@type("pg/text@1")\n  Low = "low"\n  Low = "low-again"\n}',
    );

    expect(diagnostics.map((d) => d.code)).toEqual(['PSL_EXTENSION_DUPLICATE_PARAMETER']);
    expect(diagnostics[0]).toMatchObject({ sourceId: 'schema.prisma' });
    expect(diagnostics[0]?.message).toContain('Low');
    expect(diagnostics[0]?.span?.start.line).toBeGreaterThan(0);
    // first-wins: the kept binding is the first occurrence's value
    expect(block.parameters['Low']).toMatchObject({ kind: 'value', raw: '"low"' });
  });
});

describe('reconstructExtensionBlock — end-to-end through the enum factory', () => {
  it('produces an enum handle with bare members decoded via the codec', () => {
    const block = reconstruct('enum Role {\n  @@type("pg/text@1")\n  Low\n  High\n}');
    const { handle, diagnostics } = runFactory(block);

    expect(diagnostics).toEqual([]);
    expect(handle?.enumName).toBe('Role');
    expect(handle?.codecId).toBe('pg/text@1');
    expect(handle?.nativeType).toBe('text');
    expect(handle?.enumMembers).toEqual([
      { name: 'Low', value: 'Low' },
      { name: 'High', value: 'High' },
    ]);
  });

  it('produces an enum handle with valued members decoded from JSON raw', () => {
    const block = reconstruct(
      'enum Role {\n  @@type("pg/text@1")\n  Low = "low"\n  High = "high"\n}',
    );
    const { handle, diagnostics } = runFactory(block);

    expect(diagnostics).toEqual([]);
    expect(handle?.enumMembers).toEqual([
      { name: 'Low', value: 'low' },
      { name: 'High', value: 'high' },
    ]);
  });

  it('lets the factory emit PSL_ENUM_MISSING_TYPE when @@type is absent', () => {
    const block = reconstruct('enum Role {\n  Low\n}');
    const { handle, diagnostics } = runFactory(block);

    expect(handle).toBeUndefined();
    expect(diagnostics.map((d) => d.code)).toEqual(['PSL_ENUM_MISSING_TYPE']);
  });
});
