import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it, vi } from 'vitest';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresCodecLookup,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

describe('PSL @default(...) codec-owned lowering', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPslDocumentToSqlContract = (
    input: Omit<InterpretPslDocumentToSqlContractInput, 'target' | 'scalarTypeDescriptors'>,
  ) =>
    interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      codecLookup: postgresCodecLookup,
      ...input,
    });

  describe('literal defaults dispatch through codec.decodeJson + renderSqlLiteral', () => {
    it('rejects @default(true) on an int column with a codec-typed diagnostic', () => {
      const document = parsePslDocument({
        schema: `model M {
  id Int @default(true)
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      const diagnostic = result.failure.diagnostics.find(
        (d) =>
          d.code === 'PSL_INVALID_DEFAULT_VALUE' &&
          d.message.includes('M.id') &&
          d.message.includes('pg/int4@1'),
      );
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.sourceId).toBe('schema.prisma');
      expect(diagnostic?.span?.start.line).toBe(2);
    });

    it('routes integer literal defaults through codec.decodeJson then renderSqlLiteral', () => {
      const document = parsePslDocument({
        schema: `model M {
  id Int @id
  count Int @default(42)
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)['m']?.columns['count']?.default).toEqual({
        kind: 'expression',
        expression: '42',
      });
    });

    it('routes string literal defaults through the text codec', () => {
      const document = parsePslDocument({
        schema: `model M {
  id Int @id
  label String @default("hello")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)['m']?.columns['label']?.default).toEqual({
        kind: 'expression',
        expression: "'hello'",
      });
    });

    it('invokes codec.decodeJson then codec.renderSqlLiteral in order', () => {
      const decodeJson = vi.fn((value: unknown) => value);
      const renderSqlLiteral = vi.fn((value: unknown) => String(value));
      const spyLookup: CodecLookup = {
        get: (id) => {
          if (id !== 'pg/int4@1') {
            return postgresCodecLookup.get(id);
          }
          const stub = {
            id,
            descriptor: { traits: ['equality', 'order', 'numeric', 'autoincrement'] as const },
            decodeJson,
            renderSqlLiteral,
          };
          return stub as unknown as ReturnType<CodecLookup['get']>;
        },
        targetTypesFor: postgresCodecLookup.targetTypesFor,
        metaFor: postgresCodecLookup.metaFor,
        renderOutputTypeFor: postgresCodecLookup.renderOutputTypeFor,
      };

      const document = parsePslDocument({
        schema: `model M {
  id Int @id
  count Int @default(7)
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContractInternal({
        document,
        target: postgresTarget,
        scalarTypeDescriptors: postgresScalarTypeDescriptors,
        controlMutationDefaults: builtinControlMutationDefaults,
        codecLookup: spyLookup,
      });

      expect(result.ok).toBe(true);
      expect(decodeJson).toHaveBeenCalledWith(7);
      expect(renderSqlLiteral).toHaveBeenCalledWith(7);
      expect(decodeJson.mock.invocationCallOrder[0]).toBeLessThan(
        renderSqlLiteral.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
      );
    });
  });

  describe('@default(autoincrement()) parse-time trait gating', () => {
    it('lowers @default(autoincrement()) to { kind: "autoincrement" } on a trait-bearing codec, without invoking the codec', () => {
      const decodeJson = vi.fn();
      const renderSqlLiteral = vi.fn();
      const spyLookup: CodecLookup = {
        get: (id) => {
          if (id !== 'pg/int4@1') {
            return postgresCodecLookup.get(id);
          }
          const stub = {
            id,
            descriptor: { traits: ['equality', 'order', 'numeric', 'autoincrement'] as const },
            decodeJson,
            renderSqlLiteral,
          };
          return stub as unknown as ReturnType<CodecLookup['get']>;
        },
        targetTypesFor: postgresCodecLookup.targetTypesFor,
        metaFor: postgresCodecLookup.metaFor,
        renderOutputTypeFor: postgresCodecLookup.renderOutputTypeFor,
      };

      const document = parsePslDocument({
        schema: `model M {
  id Int @id @default(autoincrement())
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContractInternal({
        document,
        target: postgresTarget,
        scalarTypeDescriptors: postgresScalarTypeDescriptors,
        controlMutationDefaults: builtinControlMutationDefaults,
        codecLookup: spyLookup,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)['m']?.columns['id']?.default).toEqual({
        kind: 'autoincrement',
      });
      expect(decodeJson).not.toHaveBeenCalled();
      expect(renderSqlLiteral).not.toHaveBeenCalled();
    });

    it('rejects @default(autoincrement()) on a non-trait codec with a span-carrying diagnostic', () => {
      const document = parsePslDocument({
        schema: `model M {
  label String @default(autoincrement())
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      const diagnostic = result.failure.diagnostics.find(
        (d) =>
          d.code === 'PSL_INVALID_DEFAULT_APPLICABILITY' &&
          d.message.includes('M.label') &&
          d.message.includes('autoincrement') &&
          d.message.includes('pg/text@1'),
      );
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.sourceId).toBe('schema.prisma');
      expect(diagnostic?.span?.start.line).toBe(2);
    });
  });

  describe('function-form defaults pass through without invoking codec methods', () => {
    it('lowers @default(now()) to { kind: "expression", expression: "now()" } without invoking codec methods', () => {
      const decodeJson = vi.fn();
      const renderSqlLiteral = vi.fn();
      const spyLookup: CodecLookup = {
        get: (id) => {
          if (id !== 'pg/timestamptz@1') {
            return postgresCodecLookup.get(id);
          }
          const stub = {
            id,
            descriptor: { traits: ['equality', 'order'] as const },
            decodeJson,
            renderSqlLiteral,
          };
          return stub as unknown as ReturnType<CodecLookup['get']>;
        },
        targetTypesFor: postgresCodecLookup.targetTypesFor,
        metaFor: postgresCodecLookup.metaFor,
        renderOutputTypeFor: postgresCodecLookup.renderOutputTypeFor,
      };

      const document = parsePslDocument({
        schema: `model M {
  id Int @id
  createdAt DateTime @default(now())
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContractInternal({
        document,
        target: postgresTarget,
        scalarTypeDescriptors: postgresScalarTypeDescriptors,
        controlMutationDefaults: builtinControlMutationDefaults,
        codecLookup: spyLookup,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)['m']?.columns['createdAt']?.default).toEqual({
        kind: 'expression',
        expression: 'now()',
      });
      expect(decodeJson).not.toHaveBeenCalled();
      expect(renderSqlLiteral).not.toHaveBeenCalled();
    });

    it('lowers @default(dbgenerated("...")) verbatim as an expression default', () => {
      const document = parsePslDocument({
        schema: `model M {
  id Int @id
  custom String @default(dbgenerated("gen_random_uuid()"))
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)['m']?.columns['custom']?.default).toEqual({
        kind: 'expression',
        expression: 'gen_random_uuid()',
      });
    });
  });

  describe('null literal default rule', () => {
    it('routes @default(null) on a nullable column to { kind: "expression", expression: "NULL" } without invoking codec', () => {
      const decodeJson = vi.fn();
      const renderSqlLiteral = vi.fn();
      const spyLookup: CodecLookup = {
        get: (id) => {
          if (id !== 'pg/text@1') {
            return postgresCodecLookup.get(id);
          }
          const stub = {
            id,
            descriptor: { traits: ['equality', 'order', 'textual'] as const },
            decodeJson,
            renderSqlLiteral,
          };
          return stub as unknown as ReturnType<CodecLookup['get']>;
        },
        targetTypesFor: postgresCodecLookup.targetTypesFor,
        metaFor: postgresCodecLookup.metaFor,
        renderOutputTypeFor: postgresCodecLookup.renderOutputTypeFor,
      };

      const document = parsePslDocument({
        schema: `model M {
  id Int @id
  nickname String? @default(null)
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContractInternal({
        document,
        target: postgresTarget,
        scalarTypeDescriptors: postgresScalarTypeDescriptors,
        controlMutationDefaults: builtinControlMutationDefaults,
        codecLookup: spyLookup,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)['m']?.columns['nickname']?.default).toEqual({
        kind: 'expression',
        expression: 'NULL',
      });
      expect(decodeJson).not.toHaveBeenCalled();
      expect(renderSqlLiteral).not.toHaveBeenCalled();
    });

    it('rejects @default(null) on a NOT NULL column with a diagnostic carrying column path, codec id, and file:line', () => {
      const document = parsePslDocument({
        schema: `model M {
  id Int @id
  label String @default(null)
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      const diagnostic = result.failure.diagnostics.find(
        (d) =>
          d.code === 'PSL_INVALID_DEFAULT_VALUE' &&
          d.message.includes('M.label') &&
          d.message.includes('pg/text@1') &&
          d.message.includes('NOT NULL'),
      );
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.sourceId).toBe('schema.prisma');
      expect(diagnostic?.span?.start.line).toBe(3);
    });
  });
});
