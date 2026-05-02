import pgvector from '@prisma-next/extension-pgvector/runtime';
import {
  extractCodecTypeImports,
  extractOperationTypeImports,
} from '@prisma-next/family-sql/test-utils';
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

  it('descriptor contributes the pg/vector@1 codec descriptor', () => {
    const descriptors = pgvector.codecs();
    expect(descriptors).toBeDefined();

    const vectorDescriptor = descriptors.find((d) => d.codecId === 'pg/vector@1');
    expect(vectorDescriptor).toBeDefined();
    expect(vectorDescriptor?.codecId).toBe('pg/vector@1');
    expect(vectorDescriptor?.targetTypes).toEqual(['vector']);
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

  it('descriptor materializes a runtime codec when factory is called', { timeout: 1_000 }, () => {
    const descriptors = pgvector.codecs();
    const vectorDescriptor = descriptors.find((d) => d.codecId === 'pg/vector@1');
    expect(vectorDescriptor).toBeDefined();

    const codec = vectorDescriptor!.factory({ length: 3 })({ name: '<test>' });
    expect(codec.id).toBe('pg/vector@1');
  });
});
