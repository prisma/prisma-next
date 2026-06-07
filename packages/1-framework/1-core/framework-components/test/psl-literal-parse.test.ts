/**
 * Unit tests for the PSL-literal parse/validate hook on the codec descriptor
 * surface (D2 — TML-2804).
 *
 * Covers:
 * - `CodecDescriptorImpl.parsePslLiteral` default: rejects every input with a
 *   "not supported" message.
 * - `CodecLookup.parsePslLiteralFor` wired through `extractCodecLookup`: resolves
 *   to the registered descriptor's implementation; returns a not-registered error
 *   for unknown codec ids.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';
import { extractCodecLookup } from '../src/control/control-stack';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type PslLiteralParseResult,
  voidParamsSchema,
} from '../src/exports/codec';

// Minimal stub codec — only the build-time hooks matter for this test.
class StubStringCodec extends CodecImpl<'stub/string@1', readonly ['textual'], string, string> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

// Descriptor that overrides parsePslLiteral to accept double-quoted strings.
class StubStringDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = 'stub/string@1' as const;
  override readonly traits = ['textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override parsePslLiteral(raw: string): PslLiteralParseResult {
    const trimmed = raw.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
      return { ok: true, value: trimmed.slice(1, -1) };
    }
    return { ok: false, error: `expected a double-quoted string, got: ${raw}` };
  }
  override factory(): (ctx: CodecInstanceContext) => StubStringCodec {
    return () => new StubStringCodec(this);
  }
}

// Descriptor that does NOT override parsePslLiteral — uses the CodecDescriptorImpl default.
class StubOpaqueDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = 'stub/opaque@1' as const;
  override readonly traits = [] as const;
  override readonly targetTypes = ['blob'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => StubStringCodec {
    // Reuse the string codec instance as a stand-in; only the descriptor is under test.
    return () => new StubStringCodec(this as never);
  }
}

const stubStringDescriptor = new StubStringDescriptor();
const stubOpaqueDescriptor = new StubOpaqueDescriptor();

// Build a CodecLookup that knows both stub descriptors.
function buildLookup() {
  const codecDescriptors: readonly AnyCodecDescriptor[] = [
    stubStringDescriptor,
    stubOpaqueDescriptor,
  ];
  return extractCodecLookup([
    { id: 'stub-extension', types: { codecTypes: { codecDescriptors } } },
  ]);
}

describe('CodecDescriptorImpl.parsePslLiteral default', () => {
  it('rejects every input for a descriptor that does not override the hook', () => {
    const result = stubOpaqueDescriptor.parsePslLiteral('"anything"');
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain('stub/opaque@1');
    expect((result as { ok: false; error: string }).error).toContain('does not support');
  });

  it('includes the codec id in the rejection message', () => {
    const result = stubOpaqueDescriptor.parsePslLiteral('42');
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain('stub/opaque@1');
  });
});

describe('CodecLookup.parsePslLiteralFor', () => {
  const lookup = buildLookup();

  describe('registered codec with parsePslLiteral override', () => {
    it('accepts a valid double-quoted string literal', () => {
      const result = lookup.parsePslLiteralFor('stub/string@1', '"auth.uid() = user_id"');
      expect(result).toEqual({ ok: true, value: 'auth.uid() = user_id' });
    });

    it('accepts an empty double-quoted string', () => {
      const result = lookup.parsePslLiteralFor('stub/string@1', '""');
      expect(result).toEqual({ ok: true, value: '' });
    });

    it('rejects a bare word (no quotes)', () => {
      const result = lookup.parsePslLiteralFor('stub/string@1', 'permissive');
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(/double-quoted/);
    });

    it('rejects a number literal', () => {
      const result = lookup.parsePslLiteralFor('stub/string@1', '42');
      expect(result.ok).toBe(false);
    });
  });

  describe('registered codec without parsePslLiteral override', () => {
    it('falls back to the CodecDescriptorImpl default and rejects', () => {
      const result = lookup.parsePslLiteralFor('stub/opaque@1', '"value"');
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain('stub/opaque@1');
    });
  });

  describe('unknown codec id', () => {
    it('returns a not-registered rejection', () => {
      const result = lookup.parsePslLiteralFor('nonexistent/codec@1', '"value"');
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain('nonexistent/codec@1');
    });
  });
});
