import pgvector from '@prisma-next/extension-pgvector/runtime';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractOperationTypeImports,
} from '@prisma-next/family-sql/test-utils';
import { createOperationRegistry } from '@prisma-next/operations';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { getSqlDescriptorBundle, pgvectorExtensionDescriptor } from '../utils/framework-components';

describe('pgvector extension pack integration', () => {
  it('exposes pgvector descriptor metadata', () => {
    expect(pgvectorExtensionDescriptor.id).toBe('pgvector');
    expect(pgvectorExtensionDescriptor.version).toBe('0.0.1');
  });

  it('extracts codec type imports from descriptors', () => {
    const { descriptors } = getSqlDescriptorBundle({
      extensions: [pgvectorExtensionDescriptor],
    });

    const codecTypeImports = extractCodecTypeImports(descriptors);
    expect(codecTypeImports.length).toBe(14);
    // Adapter codec types come first
    expect(codecTypeImports[0]).toEqual({
      package: '@prisma-next/adapter-postgres/codec-types',
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
    const { descriptors } = getSqlDescriptorBundle({
      extensions: [pgvectorExtensionDescriptor],
    });

    const operationTypeImports = extractOperationTypeImports(descriptors);
    expect(operationTypeImports.length).toBe(1);
    expect(operationTypeImports[0]).toEqual({
      package: '@prisma-next/extension-pgvector/operation-types',
      named: 'OperationTypes',
      alias: 'PgVectorOperationTypes',
    });
  });

  it('assembles operation registry from descriptors', () => {
    const { descriptors } = getSqlDescriptorBundle({
      extensions: [pgvectorExtensionDescriptor],
    });

    const registry = assembleOperationRegistry(descriptors);

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

  it('descriptor provides codecs', () => {
    const codecs = pgvector.codecs();
    expect(codecs).toBeDefined();

    const vectorCodec = codecs.get('pg/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('pg/vector@1');
    expect(vectorCodec?.targetTypes).toEqual(['vector']);
  });

  it('descriptor provides operation signatures', () => {
    const operations = pgvector.operationSignatures();
    expect(operations).toBeDefined();
    expect(operations.length).toBe(1);

    const cosineDistanceOp = operations[0];
    expect(cosineDistanceOp?.forTypeId).toBe('pg/vector@1');
    expect(cosineDistanceOp?.method).toBe('cosineDistance');
  });

  it('codecs can be registered in registry', () => {
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

  it('operations can be registered in registry', () => {
    const operations = pgvector.operationSignatures();
    expect(operations).toBeDefined();

    const registry = createOperationRegistry();
    for (const op of operations) {
      registry.register(op);
    }

    const registeredOps = registry.byType('pg/vector@1');
    expect(registeredOps.length).toBe(1);
    expect(registeredOps[0]?.method).toBe('cosineDistance');
  });
});
