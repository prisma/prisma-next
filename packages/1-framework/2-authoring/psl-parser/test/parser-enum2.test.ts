import type { PslEnum2, PslEnum2Value } from '@prisma-next/framework-components/psl-ast';
import {
  flatPslEnum2s,
  flatPslEnums,
  flatPslModels,
} from '@prisma-next/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { parsePslDocument } from '../src/parser';

describe('parsePslDocument — enum2 blocks', () => {
  it('parses bare members (no = value)', () => {
    const schema = `
enum2 Priority {
  @@type("pg/text@1")
  Low
  High
  Urgent
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const enums = flatPslEnum2s(result.ast);
    expect(enums).toHaveLength(1);
    const priority = enums[0];
    expect(priority?.kind).toBe('enum2');
    expect(priority?.name).toBe('Priority');
    expect(priority?.values).toHaveLength(3);
    expect(priority?.values[0]).toMatchObject({ kind: 'enum2Value', name: 'Low' });
    expect(priority?.values[0]).not.toHaveProperty('rawValue');
    expect(priority?.values[1]).toMatchObject({ kind: 'enum2Value', name: 'High' });
    expect(priority?.values[2]).toMatchObject({ kind: 'enum2Value', name: 'Urgent' });
  });

  it('parses = value members with string literals', () => {
    const schema = `
enum2 Priority {
  @@type("pg/text@1")
  Low    = "low"
  High   = "high"
  Urgent = "urgent"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const enums = flatPslEnum2s(result.ast);
    const priority = enums[0];
    expect(priority?.values).toHaveLength(3);
    expect(priority?.values[0]).toMatchObject({ name: 'Low', rawValue: '"low"' });
    expect(priority?.values[1]).toMatchObject({ name: 'High', rawValue: '"high"' });
    expect(priority?.values[2]).toMatchObject({ name: 'Urgent', rawValue: '"urgent"' });
  });

  it('parses = value members with number literals', () => {
    const schema = `
enum2 Priority {
  @@type("pg/int4@1")
  Low    = 1
  High   = 2
  Urgent = 3
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const enums = flatPslEnum2s(result.ast);
    const priority = enums[0];
    expect(priority?.values[0]).toMatchObject({ name: 'Low', rawValue: '1' });
    expect(priority?.values[1]).toMatchObject({ name: 'High', rawValue: '2' });
    expect(priority?.values[2]).toMatchObject({ name: 'Urgent', rawValue: '3' });
  });

  it('parses mixed bare and valued members in one block', () => {
    const schema = `
enum2 Mixed {
  @@type("pg/text@1")
  Bare
  Assigned = "assigned"
  AlsoBare
  Also = 42
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const enums = flatPslEnum2s(result.ast);
    const mixed = enums[0];
    expect(mixed?.values).toHaveLength(4);
    expect(mixed?.values[0]).toMatchObject({ name: 'Bare' });
    expect(mixed?.values[0]).not.toHaveProperty('rawValue');
    expect(mixed?.values[1]).toMatchObject({ name: 'Assigned', rawValue: '"assigned"' });
    expect(mixed?.values[2]).toMatchObject({ name: 'AlsoBare' });
    expect(mixed?.values[2]).not.toHaveProperty('rawValue');
    expect(mixed?.values[3]).toMatchObject({ name: 'Also', rawValue: '42' });
  });

  it('captures the @@type block attribute', () => {
    const schema = `
enum2 Status {
  @@type("pg/text@1")
  Active = "active"
  Inactive = "inactive"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(true);
    const enums = flatPslEnum2s(result.ast);
    const status = enums[0];
    expect(status?.attributes).toHaveLength(1);
    expect(status?.attributes[0]).toMatchObject({
      kind: 'attribute',
      target: 'enum2',
      name: 'type',
      args: [{ kind: 'positional', value: '"pg/text@1"' }],
    });
  });

  it('parses a document with both a native enum and an enum2 without interference', () => {
    const schema = `
enum NativeRole {
  USER
  ADMIN
}

enum2 Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}

model Post {
  id       Int      @id
  priority Priority
  role     NativeRole
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const nativeEnums = flatPslEnums(result.ast);
    expect(nativeEnums).toHaveLength(1);
    expect(nativeEnums[0]?.name).toBe('NativeRole');
    expect(nativeEnums[0]?.kind).toBe('enum');

    const enum2s = flatPslEnum2s(result.ast);
    expect(enum2s).toHaveLength(1);
    expect(enum2s[0]?.name).toBe('Priority');
    expect(enum2s[0]?.kind).toBe('enum2');

    const models = flatPslModels(result.ast);
    expect(models).toHaveLength(1);
  });

  it('parses an enum2 without @@type (missing @@type is left to interpreter validation)', () => {
    const schema = `
enum2 Priority {
  Low  = "low"
  High = "high"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const enums = flatPslEnum2s(result.ast);
    const priority = enums[0];
    expect(priority?.attributes).toHaveLength(0);
    expect(priority?.values).toHaveLength(2);
  });

  it('captures a raw value that contains @map( as a substring', () => {
    const schema = `
enum2 Status {
  @@type("pg/text@1")
  Foo = "@map(x)"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const enums = flatPslEnum2s(result.ast);
    expect(enums[0]?.values[0]).toMatchObject({ name: 'Foo', rawValue: '"@map(x)"' });
  });

  it('produces a diagnostic when @map appears on an enum2 member', () => {
    const schema = `
enum2 Status {
  @@type("pg/text@1")
  Active @map("active_db")
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'PSL_INVALID_ENUM2_MEMBER')).toBe(true);
    expect(result.diagnostics.find((d) => d.code === 'PSL_INVALID_ENUM2_MEMBER')?.message).toMatch(
      /@map/,
    );
  });

  it('produces a span-accurate diagnostic for a malformed member line', () => {
    const schema = `
enum2 Status {
  @@type("pg/text@1")
  not a valid line = here
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(false);
    const diag = result.diagnostics.find((d) => d.code === 'PSL_INVALID_ENUM2_MEMBER');
    expect(diag).toBeDefined();
    expect(diag?.span.start.line).toBe(4);
  });

  it('carries accurate spans on enum2 values', () => {
    const schema = `
enum2 Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(true);
    const enums = flatPslEnum2s(result.ast);
    const values = enums[0]?.values ?? [];
    expect(values[0]?.span.start.line).toBe(4);
    expect(values[1]?.span.start.line).toBe(5);
  });

  it('carries span on the whole enum2 block', () => {
    const schema = `
enum2 Priority {
  @@type("pg/text@1")
  Low  = "low"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });

    expect(result.ok).toBe(true);
    const enums = flatPslEnum2s(result.ast);
    const priority = enums[0];
    expect(priority?.span.start.line).toBe(2);
    expect(priority?.span.end.line).toBe(5);
  });

  it('PslEnum2Value type has the expected shape', () => {
    const schema = `
enum2 Priority {
  @@type("pg/text@1")
  Low = "low"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
    expect(result.ok).toBe(true);
    const value: PslEnum2Value | undefined = flatPslEnum2s(result.ast)[0]?.values[0];
    expect(value?.kind).toBe('enum2Value');
    expect(value?.name).toBe('Low');
    expect(value?.rawValue).toBe('"low"');
  });

  it('PslEnum2 type has the expected shape', () => {
    const schema = `
enum2 Priority {
  @@type("pg/text@1")
  Low = "low"
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
    expect(result.ok).toBe(true);
    const e: PslEnum2 | undefined = flatPslEnum2s(result.ast)[0];
    expect(e?.kind).toBe('enum2');
    expect(e?.name).toBe('Priority');
  });
});
