import type { AuthoringPslBlockDescriptor } from '@prisma-next/framework-components/authoring';
import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { type ResolvedDocument, type ResolveOptions, resolve } from '../src/resolve';
import { GenericBlockDeclarationAst } from '../src/syntax/ast/declarations';
import { frameworkScalarTypes } from './support';

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

function resolveDoc(
  source: string,
  options?: Omit<ResolveOptions, 'scalarTypes'> & { scalarTypes?: ReadonlySet<string> },
): ResolvedDocument {
  const { document, sourceFile } = parse(source);
  return resolve(document, sourceFile, { scalarTypes: frameworkScalarTypes, ...options });
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

  it('lands the enum block in extensionBlocks keyed by its name', () => {
    const doc = resolveDoc(source, {
      pslBlockDescriptors: { enum: enumDescriptor },
      codecLookup: textCodecLookup,
    });
    const ns = doc.namespaces.get(UNSPECIFIED_PSL_NAMESPACE_ID);
    expect(ns?.extensionBlocks.has('Priority')).toBe(true);
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

describe('field references to named generic blocks resolve to block-type targets', () => {
  it('resolves an enum-typed field to a block target and records the keyword on blockTypes', () => {
    const doc = resolveDoc(
      `
enum Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}

model Ticket {
  id     String @id
  status Priority
}
`,
      { pslBlockDescriptors: { enum: enumDescriptor }, codecLookup: textCodecLookup },
    );
    const ns = doc.namespaces.get(UNSPECIFIED_PSL_NAMESPACE_ID);
    const status = ns?.models.get('Ticket')?.fields.get('status');
    expect(status?.type.target).toEqual({
      kind: 'block',
      namespaceId: UNSPECIFIED_PSL_NAMESPACE_ID,
      name: 'Priority',
    });
    expect(ns?.blockTypes.get('Priority')).toEqual({
      name: 'Priority',
      keyword: 'enum',
      namespaceId: UNSPECIFIED_PSL_NAMESPACE_ID,
      syntax: expect.any(GenericBlockDeclarationAst),
    });
    expect(doc.diagnostics).toEqual([]);
  });

  it('records a named generic block as a block type even with no registered descriptor', () => {
    const doc = resolveDoc(
      `
enum Priority {
  Low = "low"
}

model Ticket {
  id     String @id
  status Priority
}
`,
    );
    const ns = doc.namespaces.get(UNSPECIFIED_PSL_NAMESPACE_ID);
    expect(ns?.blockTypes.get('Priority')?.keyword).toBe('enum');
    expect(ns?.models.get('Ticket')?.fields.get('status')?.type.target).toEqual({
      kind: 'block',
      namespaceId: UNSPECIFIED_PSL_NAMESPACE_ID,
      name: 'Priority',
    });
  });

  it('resolves a field typed by a non-enum named block to a block target carrying that keyword', () => {
    const doc = resolveDoc(
      `
policy_select Restricted {
  rule = "owner"
}

model Document {
  id     String @id
  access Restricted
}
`,
    );
    const ns = doc.namespaces.get(UNSPECIFIED_PSL_NAMESPACE_ID);
    expect(ns?.blockTypes.get('Restricted')?.keyword).toBe('policy_select');
    expect(ns?.models.get('Document')?.fields.get('access')?.type.target).toEqual({
      kind: 'block',
      namespaceId: UNSPECIFIED_PSL_NAMESPACE_ID,
      name: 'Restricted',
    });
  });

  it('resolves a qualified cross-namespace reference to a namespaced block type', () => {
    const doc = resolveDoc(
      `
namespace catalog {
  enum Priority {
    Low = "low"
  }
}

namespace tickets {
  model Ticket {
    id     String @id
    status catalog.Priority
  }
}
`,
    );
    expect(
      doc.namespaces.get('tickets')?.models.get('Ticket')?.fields.get('status')?.type.target,
    ).toEqual({ kind: 'block', namespaceId: 'catalog', name: 'Priority' });
  });

  it('leaves a genuinely unknown field type unresolved', () => {
    const doc = resolveDoc(
      `
model Ticket {
  id     String @id
  status Mystery
}
`,
    );
    expect(
      doc.namespaces.get(UNSPECIFIED_PSL_NAMESPACE_ID)?.models.get('Ticket')?.fields.get('status')
        ?.type.target,
    ).toEqual({ kind: 'unresolved', typeName: 'Mystery' });
    expect(doc.diagnostics.map((d) => d.code)).toContain('PSL_UNRESOLVED_TYPE_REFERENCE');
  });

  it('treats a block name colliding with a model as a duplicate declaration, first wins', () => {
    const doc = resolveDoc(
      `
model Priority {
  id String @id
}

enum Priority {
  Low = "low"
}
`,
    );
    const ns = doc.namespaces.get(UNSPECIFIED_PSL_NAMESPACE_ID);
    expect(ns?.models.has('Priority')).toBe(true);
    expect(ns?.blockTypes.has('Priority')).toBe(false);
    expect(doc.diagnostics.map((d) => d.code)).toContain('PSL_DUPLICATE_DECLARATION');
  });
});

describe('per-target scalar set', () => {
  const source = `
model Account {
  id    String @id
  owner ObjectId
}
`;

  it('leaves a target-specific scalar unresolved under the framework scalar set', () => {
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
      scalarTypes: new Set([...frameworkScalarTypes, 'ObjectId']),
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
    const doc = resolve(document, sourceFile, { scalarTypes: frameworkScalarTypes });
    const diagnostic = doc.diagnostics.find((d) => d.code === 'PSL_UNRESOLVED_TYPE_REFERENCE');
    expect(diagnostic).toBeDefined();
    // `Mystery` starts at column 8 of line 1 (zero-based line index).
    expect(diagnostic?.range.start).toEqual({ line: 1, character: 8 });
  });
});
