import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExtensionPacks } from '@prisma-next/cli/pack-loading';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { createOperationRegistry } from '@prisma-next/operations';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  assembleOperationRegistryFromPacks,
  extractCodecTypeImportsFromPacks,
  extractOperationTypeImportsFromPacks,
} from '../../../packages/sql/family/src/core/assembly';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('pgvector extension pack integration', () => {
  it('loads extension pack manifest', () => {
    const packPath = join(__dirname, '../../../packages/extensions/pgvector');
    const packs = loadExtensionPacks(undefined, [packPath]);

    expect(packs.length).toBe(1);
    const pack = packs[0];
    expect(pack).toBeDefined();
    expect(pack?.manifest.id).toBe('pgvector');
    expect(pack?.manifest.version).toBe('1.0.0');
  });

  it('extracts codec type imports from pack', () => {
    const packPath = join(__dirname, '../../../packages/extensions/pgvector');
    const packs = loadExtensionPacks(undefined, [packPath]);

    const codecTypeImports = extractCodecTypeImportsFromPacks(packs);
    expect(codecTypeImports.length).toBe(1);
    expect(codecTypeImports[0]).toEqual({
      package: '@prisma-next/extension-pgvector/codec-types',
      named: 'CodecTypes',
      alias: 'PgVectorTypes',
    });
  });

  it('extracts operation type imports from pack', () => {
    const packPath = join(__dirname, '../../../packages/extensions/pgvector');
    const packs = loadExtensionPacks(undefined, [packPath]);

    const operationTypeImports = extractOperationTypeImportsFromPacks(packs);
    expect(operationTypeImports.length).toBe(1);
    expect(operationTypeImports[0]).toEqual({
      package: '@prisma-next/extension-pgvector/operation-types',
      named: 'OperationTypes',
      alias: 'PgVectorOperationTypes',
    });
  });

  it('assembles operation registry from pack', () => {
    const packPath = join(__dirname, '../../../packages/extensions/pgvector');
    const packs = loadExtensionPacks(undefined, [packPath]);

    const registry = assembleOperationRegistryFromPacks(packs);

    const operations = registry.byType('pg/vector@1');
    expect(operations.length).toBe(1);
    expect(operations[0]?.method).toBe('cosineDistance');
    expect(operations[0]?.forTypeId).toBe('pg/vector@1');
    expect(operations[0]?.args).toEqual([{ kind: 'param' }]);
    expect(operations[0]?.returns).toEqual({ kind: 'builtin', type: 'number' });
    // Note: lowering is SQL-specific and not part of core OperationSignature
    // The SQL family descriptor converts manifests to SqlOperationSignature with lowering
    // but the registry returns core OperationSignature types
  });

  it('runtime extension provides codecs', () => {
    const extension = pgvector();
    const codecs = extension.codecs?.();
    expect(codecs).toBeDefined();

    const vectorCodec = codecs?.get('pg/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('pg/vector@1');
    expect(vectorCodec?.targetTypes).toEqual(['vector']);
  });

  it('runtime extension provides operations', () => {
    const extension = pgvector();
    const operations = extension.operations?.();
    expect(operations).toBeDefined();
    expect(operations?.length).toBe(1);

    const cosineDistanceOp = operations?.[0];
    expect(cosineDistanceOp?.forTypeId).toBe('pg/vector@1');
    expect(cosineDistanceOp?.method).toBe('cosineDistance');
  });

  it('codecs can be registered in registry', () => {
    const extension = pgvector();
    const extensionCodecs = extension.codecs?.();
    expect(extensionCodecs).toBeDefined();

    const registry = createCodecRegistry();
    for (const codec of extensionCodecs?.values() ?? []) {
      registry.register(codec);
    }

    const vectorCodec = registry.get('pg/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('pg/vector@1');
  });

  it('operations can be registered in registry', () => {
    const extension = pgvector();
    const extensionOperations = extension.operations?.();
    expect(extensionOperations).toBeDefined();

    const registry = createOperationRegistry();
    for (const op of extensionOperations ?? []) {
      registry.register(op);
    }

    const operations = registry.byType('pg/vector@1');
    expect(operations.length).toBe(1);
    expect(operations[0]?.method).toBe('cosineDistance');
  });
});
