import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CodecRegistry, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  type SqlRuntimeExtensionDescriptor,
  type SqlRuntimeExtensionInstance,
} from '../src/sql-context';
import {
  createUserlandGeneratorRegistry,
  resolveUserlandDefaults,
  type UserlandGeneratorDefinition,
} from '../src/userland-generators';

/**
 * Creates a custom alphabet ID generator (similar to nanoid customAlphabet).
 * This is a simple implementation for testing without external dependencies.
 */
function customAlphabet(alphabet: string, length: number): () => string {
  return () => {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return result;
  };
}

// Create a hex-only ID generator with 12 characters (like nanoid with custom alphabet)
const hexNanoid = customAlphabet('0123456789abcdef', 12);

// Contract with userland default on id column
const contractWithUserlandDefault: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  coreHash: 'sha256:test' as never,
  models: {},
  relations: {},
  storage: {
    tables: {
      post: {
        columns: {
          id: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'userland', name: 'nanoid' },
          },
          title: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
};

describe('userland generators', () => {
  describe('createUserlandGeneratorRegistry', () => {
    it('creates an empty registry', () => {
      const registry = createUserlandGeneratorRegistry();
      expect(registry.size).toBe(0);
    });

    it('allows adding generators', () => {
      const registry = createUserlandGeneratorRegistry();
      registry.set('nanoid', hexNanoid);
      expect(registry.size).toBe(1);
      expect(registry.has('nanoid')).toBe(true);
    });
  });

  describe('resolveUserlandDefaults', () => {
    it('returns original data when registry is empty', () => {
      const registry = createUserlandGeneratorRegistry();
      const data = { title: 'Hello World' };

      const result = resolveUserlandDefaults(data, 'post', contractWithUserlandDefault, registry);

      expect(result).toEqual({ title: 'Hello World' });
    });

    it('generates value for column with userland default', () => {
      const registry = createUserlandGeneratorRegistry();
      registry.set('nanoid', hexNanoid);
      const data = { title: 'Hello World' };

      const result = resolveUserlandDefaults(data, 'post', contractWithUserlandDefault, registry);

      expect(result['title']).toBe('Hello World');
      expect(result['id']).toBeDefined();
      expect(typeof result['id']).toBe('string');
      expect(result['id']).toHaveLength(12);
      // Verify it's hex only
      expect(result['id']).toMatch(/^[0-9a-f]{12}$/);
    });

    it('does not override provided values', () => {
      const registry = createUserlandGeneratorRegistry();
      registry.set('nanoid', hexNanoid);
      const data = { id: 'custom-id', title: 'Hello World' };

      const result = resolveUserlandDefaults(data, 'post', contractWithUserlandDefault, registry);

      expect(result['id']).toBe('custom-id');
      expect(result['title']).toBe('Hello World');
    });

    it('generates unique values on each call', () => {
      const registry = createUserlandGeneratorRegistry();
      registry.set('nanoid', hexNanoid);
      const data1 = { title: 'Post 1' };
      const data2 = { title: 'Post 2' };

      const result1 = resolveUserlandDefaults(data1, 'post', contractWithUserlandDefault, registry);
      const result2 = resolveUserlandDefaults(data2, 'post', contractWithUserlandDefault, registry);

      expect(result1['id']).not.toBe(result2['id']);
    });

    it('returns original data for non-existent table', () => {
      const registry = createUserlandGeneratorRegistry();
      registry.set('nanoid', hexNanoid);
      const data = { title: 'Hello World' };

      const result = resolveUserlandDefaults(
        data,
        'nonexistent',
        contractWithUserlandDefault,
        registry,
      );

      expect(result).toEqual({ title: 'Hello World' });
    });
  });

  describe('extension integration', () => {
    // Stub adapter codecs
    function createStubCodecs(): CodecRegistry {
      const registry = createCodecRegistry();
      registry.register(
        codec({
          typeId: 'pg/text@1',
          targetTypes: ['text'],
          encode: (v: string) => v,
          decode: (w: string) => w,
        }),
      );
      return registry;
    }

    // Create a test adapter descriptor
    function createTestAdapterDescriptor() {
      const codecs = createStubCodecs();
      return {
        kind: 'adapter' as const,
        id: 'test-adapter',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        create() {
          return {
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
            profile: {
              id: 'test-profile',
              target: 'postgres',
              capabilities: {},
              codecs() {
                return codecs;
              },
            },
            lower(ast: SelectAst) {
              return {
                profileId: 'test-profile',
                body: Object.freeze({ sql: JSON.stringify(ast), params: [] }),
              };
            },
          };
        },
      };
    }

    // Create a test target descriptor
    function createTestTargetDescriptor() {
      return {
        kind: 'target' as const,
        id: 'postgres',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        create() {
          return { familyId: 'sql' as const, targetId: 'postgres' as const };
        },
      };
    }

    it('collects userland generators from extensions', () => {
      // Create an extension that provides the nanoid generator
      const nanoidExtension: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension',
        id: 'nanoid-extension',
        version: '0.0.1',
        familyId: 'sql',
        targetId: 'postgres',
        create(): SqlRuntimeExtensionInstance<'postgres'> {
          return {
            familyId: 'sql',
            targetId: 'postgres',
            userlandGenerators(): ReadonlyArray<UserlandGeneratorDefinition> {
              return [{ name: 'nanoid', generator: hexNanoid }];
            },
          };
        },
      };

      const context = createRuntimeContext({
        contract: contractWithUserlandDefault,
        target: createTestTargetDescriptor(),
        adapter: createTestAdapterDescriptor(),
        extensionPacks: [nanoidExtension],
      });

      expect(context.userlandGenerators).toBeDefined();
      expect(context.userlandGenerators.size).toBe(1);
      expect(context.userlandGenerators.has('nanoid')).toBe(true);

      // Test that the generator works
      const generator = context.userlandGenerators.get('nanoid');
      expect(generator).toBeDefined();
      const value = generator!();
      expect(typeof value).toBe('string');
      expect(value).toHaveLength(12);
      expect(value).toMatch(/^[0-9a-f]{12}$/);
    });

    it('context without extensions has empty generator registry', () => {
      const context = createRuntimeContext({
        contract: contractWithUserlandDefault,
        target: createTestTargetDescriptor(),
        adapter: createTestAdapterDescriptor(),
      });

      expect(context.userlandGenerators).toBeDefined();
      expect(context.userlandGenerators.size).toBe(0);
    });

    it('collects generators from multiple extensions', () => {
      let counter = 0;
      const sequentialGenerator = () => `seq-${++counter}`;

      const ext1: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension',
        id: 'ext1',
        version: '0.0.1',
        familyId: 'sql',
        targetId: 'postgres',
        create(): SqlRuntimeExtensionInstance<'postgres'> {
          return {
            familyId: 'sql',
            targetId: 'postgres',
            userlandGenerators() {
              return [{ name: 'nanoid', generator: hexNanoid }];
            },
          };
        },
      };

      const ext2: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension',
        id: 'ext2',
        version: '0.0.1',
        familyId: 'sql',
        targetId: 'postgres',
        create(): SqlRuntimeExtensionInstance<'postgres'> {
          return {
            familyId: 'sql',
            targetId: 'postgres',
            userlandGenerators() {
              return [{ name: 'sequential', generator: sequentialGenerator }];
            },
          };
        },
      };

      const context = createRuntimeContext({
        contract: contractWithUserlandDefault,
        target: createTestTargetDescriptor(),
        adapter: createTestAdapterDescriptor(),
        extensionPacks: [ext1, ext2],
      });

      expect(context.userlandGenerators.size).toBe(2);
      expect(context.userlandGenerators.has('nanoid')).toBe(true);
      expect(context.userlandGenerators.has('sequential')).toBe(true);
    });
  });
});
