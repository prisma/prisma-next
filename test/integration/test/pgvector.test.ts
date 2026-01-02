import pgvector from '@prisma-next/extension-pgvector/runtime';
import {
  assembleOperationRegistry,
  convertOperationManifest,
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
    expect(pgvectorExtensionDescriptor.version).toBe('1.0.0');
  });

  it('extracts codec type imports from pack', () => {
    const { descriptors } = getSqlDescriptorBundle({
      extensions: [pgvectorExtensionDescriptor],
    });

    const codecTypeImports = extractCodecTypeImports(descriptors);
    expect(codecTypeImports.length).toBe(2);
    // Adapter codec types come first
    expect(codecTypeImports[0]).toEqual({
      package: '@prisma-next/adapter-postgres/codec-types',
      named: 'CodecTypes',
      alias: 'PgTypes',
    });
    // Extension codec types come after
    expect(codecTypeImports[1]).toEqual({
      package: '@prisma-next/extension-pgvector/codec-types',
      named: 'CodecTypes',
      alias: 'PgVectorTypes',
    });
  });

  it('extracts operation type imports from pack', () => {
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

  it('assembles operation registry from pack', () => {
    const { descriptors } = getSqlDescriptorBundle({
      extensions: [pgvectorExtensionDescriptor],
    });

    const registry = assembleOperationRegistry(descriptors, convertOperationManifest);

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
    const extension = pgvector.create();
    const codecs = extension.codecs?.();
    expect(codecs).toBeDefined();

    const vectorCodec = codecs?.get('pg/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('pg/vector@1');
    expect(vectorCodec?.targetTypes).toEqual(['vector']);
  });

  it('runtime extension provides operations', () => {
    const extension = pgvector.create();
    const operations = extension.operations?.();
    expect(operations).toBeDefined();
    expect(operations?.length).toBe(1);

    const cosineDistanceOp = operations?.[0];
    expect(cosineDistanceOp?.forTypeId).toBe('pg/vector@1');
    expect(cosineDistanceOp?.method).toBe('cosineDistance');
  });

  it('codecs can be registered in registry', () => {
    const extension = pgvector.create();
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
    const extension = pgvector.create();
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
