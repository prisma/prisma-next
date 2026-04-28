import pgvector from '@prisma-next/extension-pgvector/runtime';
import {
  extractCodecTypeImports,
  extractOperationTypeImports,
} from '@prisma-next/family-sql/test-utils';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { getSqlDescriptorBundle, pgvectorExtensionDescriptor } from '../utils/framework-components';

describe('pgvector extension pack integration', () => {
  it('exposes pgvector descriptor metadata', () => {
    expect(pgvectorExtensionDescriptor.id).toBe('pgvector');
    expect(pgvectorExtensionDescriptor.version).toBe('0.0.1');
  });

  it('extracts codec type imports from descriptors', () => {
    const { target, adapter, extensions } = getSqlDescriptorBundle({
      extensions: [pgvectorExtensionDescriptor],
    });

    const codecTypeImports = extractCodecTypeImports([target, adapter, ...extensions]);
    expect(codecTypeImports.length).toBe(14);
    // Adapter codec types come first
    expect(codecTypeImports[0]).toEqual({
      package: '@prisma-next/target-postgres/codec-types',
      named: 'CodecTypes',
      alias: 'PgTypes',
    });
    expect(codecTypeImports).toContainEqual({
      package: '@prisma-next/extension-pgvector/codec-types',
      named: 'CodecTypes',
      alias: 'PgVectorTypes',
    });
    expect(codecTypeImports).toContainEqual({
      package: '@prisma-next/extension-pgvector/codec-types',
      named: 'Vector',
      alias: 'Vector',
    });
  });

  it('extracts operation type imports from descriptors', () => {
    const { target, adapter, extensions } = getSqlDescriptorBundle({
      extensions: [pgvectorExtensionDescriptor],
    });

    const operationTypeImports = extractOperationTypeImports([target, adapter, ...extensions]);
    expect(operationTypeImports.length).toBe(1);
    expect(operationTypeImports[0]).toEqual({
      package: '@prisma-next/extension-pgvector/operation-types',
      named: 'OperationTypes',
      alias: 'PgVectorOperationTypes',
    });
  });

  it('descriptor provides codecs', () => {
    const codecs = pgvector.codecs();
    expect(codecs).toBeDefined();

    const vectorCodec = codecs.get('pg/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('pg/vector@1');
    expect(vectorCodec?.targetTypes).toEqual(['vector']);
  });

  it('descriptor provides query operations', () => {
    const operations = pgvector.queryOperations!();
    expect(operations).toBeDefined();
    expect(operations.length).toBe(2);

    const cosineDistanceOp = operations.find((op) => op.method === 'cosineDistance');
    expect(cosineDistanceOp).toBeDefined();

    const cosineSimilarityOp = operations.find((op) => op.method === 'cosineSimilarity');
    expect(cosineSimilarityOp).toBeDefined();
  });

  it('codecs can be registered in registry', { timeout: 1_000 }, () => {
    const codecs = pgvector.codecs();
    expect(codecs).toBeDefined();

    const registry = createCodecRegistry();
    for (const codec of codecs.values()) {
      registry.register(codec);
    }

    const vectorCodec = registry.get('pg/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('pg/vector@1');
  });
});
