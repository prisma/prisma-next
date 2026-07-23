import type { EnumTypeHandle } from '@prisma-next/contract-authoring';
import { enumType } from '@prisma-next/contract-authoring';
import type {
  AuthoringContributions,
  AuthoringEntityContext,
  PslExtensionBlock,
} from '@prisma-next/framework-components/authoring';
import { resolveEnumCodecId } from '@prisma-next/framework-components/authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { buildSymbolTable, type SymbolTable } from '@prisma-next/psl-parser';
import type { SourceFile } from '@prisma-next/psl-parser/syntax';
import { parse } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';

const mongoScalarTypeDescriptors: ReadonlyMap<string, string> = new Map([
  ['String', 'mongo/string@1'],
  ['Int', 'mongo/int32@1'],
  ['ObjectId', 'mongo/objectId@1'],
]);

const mongoTargetTypes: Record<string, readonly string[]> = {
  'mongo/string@1': ['string'],
  'mongo/string@2': ['string'],
  'mongo/int32@1': ['int'],
  'mongo/objectId@1': ['objectId'],
};

const mongoCodecLookup: CodecLookup = {
  get(id: string) {
    const targetTypes = mongoTargetTypes[id];
    if (!targetTypes) return undefined;
    return {
      id,
      encode: async (v: unknown) => v,
      decode: async (w: unknown) => w,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    } as ReturnType<CodecLookup['get']>;
  },
  targetTypesFor: (id: string) => mongoTargetTypes[id],
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

const enumEntityDescriptor = {
  kind: 'entity',
  discriminator: 'enum',
  output: {
    factory: (
      block: PslExtensionBlock,
      ctx: AuthoringEntityContext,
    ): EnumTypeHandle | undefined => {
      const resolved = resolveEnumCodecId(block, ctx);
      if (resolved === undefined) return undefined;
      const nativeType = ctx.codecLookup?.targetTypesFor(resolved.codecId)?.[0];
      if (nativeType === undefined) return undefined;
      return enumType(
        block.name,
        { codecId: resolved.codecId, nativeType },
        ...Object.keys(block.parameters).map((name) => ({ name, value: name })),
      );
    },
  },
} as const;

const authoringContributions: AuthoringContributions = {
  entityTypes: { enum: enumEntityDescriptor },
};

const enumPslBlockDescriptors = {
  enum: {
    kind: 'pslBlock',
    keyword: 'enum',
    discriminator: 'enum',
    name: { required: true },
    parameters: {},
    variadicParameters: true,
  },
} as const;

function buildSymbolTableInput(
  schema: string,
  sourceId = 'test.prisma',
): { symbolTable: SymbolTable; sourceFile: SourceFile; sourceId: string } {
  const { document, sourceFile } = parse(schema);
  const { table } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes: [...mongoScalarTypeDescriptors.keys()],
    pslBlockDescriptors: enumPslBlockDescriptors,
  });
  return { symbolTable: table, sourceFile, sourceId };
}

const bareMemberEnumSchema = `enum WhatsAppMessageDirection {
  INBOUND
  OUTBOUND
}

model WhatsAppMessages {
  id        ObjectId @id @map("_id")
  direction WhatsAppMessageDirection
}
`;

describe('mongo PSL interpreter: enum fields', () => {
  it('resolves a bare-member enum without explicit enumInferenceCodecs', () => {
    const result = interpretPslDocumentToMongoContract({
      ...buildSymbolTableInput(bareMemberEnumSchema),
      scalarTypeDescriptors: mongoScalarTypeDescriptors,
      codecLookup: mongoCodecLookup,
      authoringContributions,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const namespace = result.value.domain.namespaces[UNBOUND_NAMESPACE_ID];
    expect(namespace?.enum).toEqual({
      WhatsAppMessageDirection: {
        codecId: 'mongo/string@1',
        members: [
          { name: 'INBOUND', value: 'INBOUND' },
          { name: 'OUTBOUND', value: 'OUTBOUND' },
        ],
      },
    });
    expect(namespace?.models['WhatsAppMessages']?.fields['direction']).toEqual({
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      nullable: false,
      valueSet: {
        plane: 'domain',
        entityKind: 'enum',
        namespaceId: UNBOUND_NAMESPACE_ID,
        entityName: 'WhatsAppMessageDirection',
      },
    });

    const storage = result.value.storage as unknown as {
      namespaces: Record<
        string,
        { entries: { valueSet?: Record<string, { kind: string; values: unknown[] }> } }
      >;
    };
    expect(storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.valueSet).toEqual({
      WhatsAppMessageDirection: { kind: 'valueSet', values: ['INBOUND', 'OUTBOUND'] },
    });
  });

  it('explicit enumInferenceCodecs overrides the scalar-descriptor default', () => {
    const result = interpretPslDocumentToMongoContract({
      ...buildSymbolTableInput(bareMemberEnumSchema),
      scalarTypeDescriptors: mongoScalarTypeDescriptors,
      codecLookup: mongoCodecLookup,
      authoringContributions,
      enumInferenceCodecs: { text: 'mongo/string@2', int: 'mongo/int32@1' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const namespace = result.value.domain.namespaces[UNBOUND_NAMESPACE_ID];
    expect(namespace?.enum?.['WhatsAppMessageDirection']?.codecId).toBe('mongo/string@2');
  });

  it('reports PSL_ENUM_CANNOT_INFER_TYPE when no inference codecs can be derived', () => {
    const descriptorsWithoutInt: ReadonlyMap<string, string> = new Map(
      [...mongoScalarTypeDescriptors].filter(([name]) => name !== 'Int'),
    );
    const { document, sourceFile } = parse(bareMemberEnumSchema);
    const { table } = buildSymbolTable({
      document,
      sourceFile,
      scalarTypes: [...descriptorsWithoutInt.keys()],
      pslBlockDescriptors: enumPslBlockDescriptors,
    });
    const result = interpretPslDocumentToMongoContract({
      symbolTable: table,
      sourceFile,
      sourceId: 'test.prisma',
      scalarTypeDescriptors: descriptorsWithoutInt,
      codecLookup: mongoCodecLookup,
      authoringContributions,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map((d) => d.code)).toEqual([
      'PSL_ENUM_CANNOT_INFER_TYPE',
      'PSL_UNSUPPORTED_FIELD_TYPE',
    ]);
  });
});
