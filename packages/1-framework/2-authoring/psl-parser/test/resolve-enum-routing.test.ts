import type { AuthoringPslBlockDescriptor } from '@prisma-next/framework-components/authoring';
import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import {
  DEFAULT_SCALAR_TYPES,
  type ResolvedDocument,
  type ResolveOptions,
  resolve,
} from '../src/resolve';

const textCodec: Codec = {
  id: 'pg/text@1',
  encode: async (value) => value,
  decode: async (wire) => wire,
  encodeJson: (value) => value as string,
  decodeJson: (json) => {
    if (typeof json !== 'string') throw new TypeError(`expected a JSON string, got ${typeof json}`);
    return json;
  },
};

const textCodecLookup: CodecLookup = {
  get: (id) => (id === 'pg/text@1' ? textCodec : undefined),
  targetTypesFor: (id) => (id === 'pg/text@1' ? ['text'] : undefined),
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

// The domain-enum descriptor a target contributes for the `enum` keyword: an
// open (variadic) parameter set so each member name is accepted as a parameter,
// with the codec carried on the `@@type` block attribute rather than a declared
// parameter.
const enumDescriptor: AuthoringPslBlockDescriptor = {
  kind: 'pslBlock',
  keyword: 'enum',
  discriminator: 'enum',
  name: { required: true },
  parameters: {},
  variadicParameters: true,
};

function resolveDoc(source: string, options?: ResolveOptions): ResolvedDocument {
  const { document, sourceFile } = parse(source);
  return resolve(document, sourceFile, options);
}

describe('enum routes through the generic-block / extension-block path', () => {
  const source = `
enum Priority {
  @@type("pg/text@1")
  Low    = "low"
  High   = "high"
  Urgent = "urgent"
}
`;

  it('lands the enum block in extensionBlocks keyed by its name, not in the enums map', () => {
    const doc = resolveDoc(source, {
      pslBlockDescriptors: { enum: enumDescriptor },
      codecLookup: textCodecLookup,
    });
    const ns = doc.namespaces.get(UNSPECIFIED_PSL_NAMESPACE_ID);
    expect(ns?.extensionBlocks.has('Priority')).toBe(true);
    expect(ns?.enums.size).toBe(0);
  });

  it('resolves a well-formed domain enum with no diagnostics', () => {
    const doc = resolveDoc(source, {
      pslBlockDescriptors: { enum: enumDescriptor },
      codecLookup: textCodecLookup,
    });
    expect(doc.diagnostics).toEqual([]);
  });

  it('flags duplicate member names with PSL_EXTENSION_DUPLICATE_PARAMETER', () => {
    const doc = resolveDoc(
      `
enum Priority {
  @@type("pg/text@1")
  Low = "low"
  Low = "low2"
}
`,
      { pslBlockDescriptors: { enum: enumDescriptor }, codecLookup: textCodecLookup },
    );
    expect(doc.diagnostics.map((d) => d.code)).toContain('PSL_EXTENSION_DUPLICATE_PARAMETER');
  });

  it('reports an enum block as unsupported when no descriptor claims the keyword', () => {
    const doc = resolveDoc(source, { codecLookup: textCodecLookup });
    expect(doc.diagnostics.map((d) => d.code)).toContain('PSL_UNSUPPORTED_TOP_LEVEL_BLOCK');
  });
});

describe('per-target scalar set', () => {
  const source = `
model Account {
  id    String @id
  owner ObjectId
}
`;

  it('leaves a target-specific scalar unresolved under the default scalar set', () => {
    const doc = resolveDoc(source);
    const owner = doc.namespaces
      .get(UNSPECIFIED_PSL_NAMESPACE_ID)
      ?.models.get('Account')
      ?.fields.get('owner');
    expect(owner?.type.target).toEqual({ kind: 'unresolved', typeName: 'ObjectId' });
    expect(doc.diagnostics.map((d) => d.code)).toContain('PSL_UNRESOLVED_TYPE_REFERENCE');
  });

  it('resolves a target-specific scalar to a scalar target when the target supplies it', () => {
    const doc = resolveDoc(source, {
      scalarTypes: new Set([...DEFAULT_SCALAR_TYPES, 'ObjectId']),
    });
    const owner = doc.namespaces
      .get(UNSPECIFIED_PSL_NAMESPACE_ID)
      ?.models.get('Account')
      ?.fields.get('owner');
    expect(owner?.type.target).toEqual({ kind: 'scalar', name: 'ObjectId' });
    expect(doc.diagnostics).toEqual([]);
  });
});

describe('resolve derives diagnostic ranges from the passed SourceFile', () => {
  it('anchors an unresolved-reference diagnostic at the offending token', () => {
    const source = 'model M {\n  ghost Mystery\n}';
    const { document, sourceFile } = parse(source);
    const doc = resolve(document, sourceFile);
    const diagnostic = doc.diagnostics.find((d) => d.code === 'PSL_UNRESOLVED_TYPE_REFERENCE');
    expect(diagnostic).toBeDefined();
    // `Mystery` starts at column 8 of line 1 (zero-based line index).
    expect(diagnostic?.range.start).toEqual({ line: 1, character: 8 });
  });
});
