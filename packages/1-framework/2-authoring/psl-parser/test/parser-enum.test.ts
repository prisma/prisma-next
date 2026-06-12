import {
  flatPslModels,
  namespacePslExtensionBlocks,
  type PslExtensionBlock,
} from '@prisma-next/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { parsePslDocument } from '../src/parser';

const enumDescriptor = {
  kind: 'pslBlock' as const,
  keyword: 'enum',
  discriminator: 'enum',
  name: { required: true },
  parameters: {},
  variadicParameters: true,
};

const pslBlockDescriptors = { enum: enumDescriptor };

function flatEnums(ast: Parameters<typeof namespacePslExtensionBlocks>[0][]): PslExtensionBlock[] {
  return ast.flatMap((ns) => namespacePslExtensionBlocks(ns).filter((b) => b.kind === 'enum'));
}

describe('parsePslDocument — enum blocks', () => {
  it('parses bare members (no = value)', () => {
    const schema = `
enum Priority {
  @@type("pg/text@1")
  Low
  High
  Urgent
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const enums = flatEnums(result.ast.namespaces);
    expect(enums).toHaveLength(1);
    const priority = enums[0];
    expect(priority?.kind).toBe('enum');
    expect(priority?.name).toBe('Priority');
    expect(Object.keys(priority?.parameters ?? {})).toHaveLength(3);
    expect(priority?.parameters['Low']?.kind).toBe('bare');
    expect(priority?.parameters['High']?.kind).toBe('bare');
    expect(priority?.parameters['Urgent']?.kind).toBe('bare');
  });

  it('parses = value members with string literals', () => {
    const schema = `
enum Priority {
  @@type("pg/text@1")
  Low    = "low"
  High   = "high"
  Urgent = "urgent"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const priority = flatEnums(result.ast.namespaces)[0];
    expect(Object.keys(priority?.parameters ?? {})).toHaveLength(3);
    expect(priority?.parameters['Low']).toMatchObject({ kind: 'value', raw: '"low"' });
    expect(priority?.parameters['High']).toMatchObject({ kind: 'value', raw: '"high"' });
    expect(priority?.parameters['Urgent']).toMatchObject({ kind: 'value', raw: '"urgent"' });
  });

  it('parses = value members with number literals', () => {
    const schema = `
enum Priority {
  @@type("pg/int4@1")
  Low    = 1
  High   = 2
  Urgent = 3
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const priority = flatEnums(result.ast.namespaces)[0];
    expect(priority?.parameters['Low']).toMatchObject({ kind: 'value', raw: '1' });
    expect(priority?.parameters['High']).toMatchObject({ kind: 'value', raw: '2' });
    expect(priority?.parameters['Urgent']).toMatchObject({ kind: 'value', raw: '3' });
  });

  it('parses mixed bare and valued members in one block', () => {
    const schema = `
enum Mixed {
  @@type("pg/text@1")
  Bare
  Assigned = "assigned"
  AlsoBare
  Also = 42
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const mixed = flatEnums(result.ast.namespaces)[0];
    expect(Object.keys(mixed?.parameters ?? {})).toHaveLength(4);
    expect(mixed?.parameters['Bare']?.kind).toBe('bare');
    expect(mixed?.parameters['Assigned']).toMatchObject({ kind: 'value', raw: '"assigned"' });
    expect(mixed?.parameters['AlsoBare']?.kind).toBe('bare');
    expect(mixed?.parameters['Also']).toMatchObject({ kind: 'value', raw: '42' });
  });

  it('captures the @@type block attribute', () => {
    const schema = `
enum Status {
  @@type("pg/text@1")
  Active = "active"
  Inactive = "inactive"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(true);
    const status = flatEnums(result.ast.namespaces)[0];
    expect(status?.blockAttributes).toHaveLength(1);
    expect(status?.blockAttributes[0]).toMatchObject({
      name: 'type',
      args: [{ kind: 'positional', value: '"pg/text@1"' }],
    });
  });

  it('produces PSL_UNSUPPORTED_TOP_LEVEL_BLOCK for an enum block with a @map member (native syntax removed)', () => {
    // After D1, `enum X { member @map("...") }` is no longer the native
    // syntax — without a registered descriptor the block is unknown; with
    // the extension-block descriptor, member lines containing `@map(` are
    // not valid extension-block member syntax and produce a diagnostic.
    const schema = `
enum Status {
  @@type("pg/text@1")
  inProgress @map("in-progress")
  done = "done"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'PSL_INVALID_EXTENSION_BLOCK_MEMBER')).toBe(
      true,
    );
  });

  it('parses an enum without @@type (missing @@type is left to interpreter validation)', () => {
    const schema = `
enum Priority {
  Low  = "low"
  High = "high"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const priority = flatEnums(result.ast.namespaces)[0];
    expect(priority?.blockAttributes).toHaveLength(0);
    expect(Object.keys(priority?.parameters ?? {})).toHaveLength(2);
  });

  it('captures a raw value that contains @map( as a substring', () => {
    const schema = `
enum Status {
  @@type("pg/text@1")
  Foo = "@map(x)"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const status = flatEnums(result.ast.namespaces)[0];
    expect(status?.parameters['Foo']).toMatchObject({ kind: 'value', raw: '"@map(x)"' });
  });

  it('produces a diagnostic for a malformed member line', () => {
    const schema = `
enum Status {
  @@type("pg/text@1")
  not a valid line = here
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(false);
    const diag = result.diagnostics.find((d) => d.code === 'PSL_INVALID_EXTENSION_BLOCK_MEMBER');
    expect(diag).toBeDefined();
    expect(diag?.span.start.line).toBe(4);
  });

  it('carries accurate spans on enum parameter values', () => {
    const schema = `
enum Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(true);
    const priority = flatEnums(result.ast.namespaces)[0];
    expect(priority?.parameters['Low']?.span.start.line).toBe(4);
    expect(priority?.parameters['High']?.span.start.line).toBe(5);
  });

  it('carries span on the whole enum block', () => {
    const schema = `
enum Priority {
  @@type("pg/text@1")
  Low  = "low"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(true);
    const priority = flatEnums(result.ast.namespaces)[0];
    expect(priority?.span.start.line).toBe(2);
    expect(priority?.span.end.line).toBe(5);
  });

  it('PslExtensionBlock type has the expected shape for enum', () => {
    const schema = `
enum Priority {
  @@type("pg/text@1")
  Low = "low"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });
    expect(result.ok).toBe(true);
    const e: PslExtensionBlock | undefined = flatEnums(result.ast.namespaces)[0];
    expect(e?.kind).toBe('enum');
    expect(e?.name).toBe('Priority');
    expect(e?.parameters['Low']).toMatchObject({ kind: 'value', raw: '"low"' });
  });

  it('emits PSL_EXTENSION_DUPLICATE_PARAMETER for duplicate member names', () => {
    const schema = `
enum Priority {
  @@type("pg/text@1")
  Low = "low"
  Low = "low-again"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.diagnostics.some((d) => d.code === 'PSL_EXTENSION_DUPLICATE_PARAMETER')).toBe(
      true,
    );
    const priority = flatEnums(result.ast.namespaces)[0];
    expect(priority?.parameters['Low']).toMatchObject({ kind: 'value', raw: '"low"' });
  });

  it('emits PSL_INVALID_EXTENSION_BLOCK_MEMBER when a declared parameter is used bare (without = value)', () => {
    const descriptorWithDeclaredParam = {
      kind: 'pslBlock' as const,
      keyword: 'enum',
      discriminator: 'enum',
      name: { required: true },
      parameters: { type: { kind: 'value' as const, required: true } },
      variadicParameters: true,
    };
    const schema = `
enum Priority {
  type
  Low = "low"
}
`;
    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
      pslBlockDescriptors: { enum: descriptorWithDeclaredParam },
    });

    expect(result.diagnostics.some((d) => d.code === 'PSL_INVALID_EXTENSION_BLOCK_MEMBER')).toBe(
      true,
    );
    const priority = flatEnums(result.ast.namespaces)[0];
    expect(priority?.parameters['type']).toBeUndefined();
  });

  it('emits PSL_UNSUPPORTED_TOP_LEVEL_BLOCK when pslBlockDescriptors is omitted', () => {
    const schema = `
enum Priority {
  Low = "low"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.diagnostics.some((d) => d.code === 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK')).toBe(true);
  });

  it('coexists with models without interference', () => {
    const schema = `
enum Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}

model Post {
  id       Int      @id
  priority Priority
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma', pslBlockDescriptors });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const enums = flatEnums(result.ast.namespaces);
    expect(enums).toHaveLength(1);
    expect(enums[0]?.name).toBe('Priority');
    expect(enums[0]?.kind).toBe('enum');

    const models = flatPslModels(result.ast);
    expect(models).toHaveLength(1);
  });
});
