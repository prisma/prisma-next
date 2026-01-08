import type { ContractIR } from '@prisma-next/contract/ir';
import type { TypeRenderEntry } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { sqlTargetFamilyHook } from '../src/index';

function createContractIR(overrides: Partial<ContractIR>): ContractIR {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'test-db',
    models: {},
    relations: {},
    storage: { tables: {} },
    extensions: {},
    capabilities: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}

describe('sql-target-family-hook parameterized type emission', () => {
  describe('columns with typeParams', () => {
    it('emits parameterized TS type via normalized renderer', () => {
      const ir = createContractIR({
        models: {
          Document: {
            storage: { table: 'document' },
            fields: {
              id: { column: 'id' },
              embedding: { column: 'embedding' },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            document: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                embedding: {
                  nativeType: 'vector(1536)',
                  codecId: 'pg/vector@1',
                  nullable: false,
                  typeParams: { length: 1536 },
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      const vectorRenderer: TypeRenderEntry = {
        codecId: 'pg/vector@1',
        render: (params) => `Vector<${params['length']}>`,
      };

      const parameterizedRenderers = new Map<string, TypeRenderEntry>();
      parameterizedRenderers.set('pg/vector@1', vectorRenderer);

      const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], {
        parameterizedRenderers,
      });

      // Should use the parameterized renderer for the vector column
      expect(types).toContain('readonly embedding: Vector<1536>');
    });

    it('falls back to CodecTypes[codecId].output for columns without typeParams', () => {
      const ir = createContractIR({
        models: {
          User: {
            storage: { table: 'user' },
            fields: {
              id: { column: 'id' },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      const vectorRenderer: TypeRenderEntry = {
        codecId: 'pg/vector@1',
        render: (params) => `Vector<${params['length']}>`,
      };

      const parameterizedRenderers = new Map<string, TypeRenderEntry>();
      parameterizedRenderers.set('pg/vector@1', vectorRenderer);

      const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], {
        parameterizedRenderers,
      });

      // int4 column should use the standard codec types lookup
      expect(types).toContain("readonly id: CodecTypes['pg/int4@1']['output']");
    });

    it('emits nullable parameterized type with | null suffix', () => {
      const ir = createContractIR({
        models: {
          Document: {
            storage: { table: 'document' },
            fields: {
              embedding: { column: 'embedding' },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            document: {
              columns: {
                embedding: {
                  nativeType: 'vector(1536)',
                  codecId: 'pg/vector@1',
                  nullable: true,
                  typeParams: { length: 1536 },
                },
              },
              primaryKey: { columns: [] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      const vectorRenderer: TypeRenderEntry = {
        codecId: 'pg/vector@1',
        render: (params) => `Vector<${params['length']}>`,
      };

      const parameterizedRenderers = new Map<string, TypeRenderEntry>();
      parameterizedRenderers.set('pg/vector@1', vectorRenderer);

      const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], {
        parameterizedRenderers,
      });

      expect(types).toContain('readonly embedding: Vector<1536> | null');
    });

    it('uses custom renderer logic for complex type generation', () => {
      const ir = createContractIR({
        models: {
          Data: {
            storage: { table: 'data' },
            fields: {
              value: { column: 'value' },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            data: {
              columns: {
                value: {
                  nativeType: 'decimal(10,2)',
                  codecId: 'pg/decimal@1',
                  nullable: false,
                  typeParams: { precision: 10, scale: 2 },
                },
              },
              primaryKey: { columns: [] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      const decimalRenderer: TypeRenderEntry = {
        codecId: 'pg/decimal@1',
        render: (params) => {
          const p = params['precision'] as number;
          const s = params['scale'] as number;
          return `Decimal<${p}, ${s}>`;
        },
      };

      const parameterizedRenderers = new Map<string, TypeRenderEntry>();
      parameterizedRenderers.set('pg/decimal@1', decimalRenderer);

      const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], {
        parameterizedRenderers,
      });

      expect(types).toContain('readonly value: Decimal<10, 2>');
    });
  });

  describe('columns with typeRef', () => {
    it('resolves typeRef to storage.types and emits parameterized type', () => {
      const ir = createContractIR({
        models: {
          Document: {
            storage: { table: 'document' },
            fields: {
              embedding: { column: 'embedding' },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            document: {
              columns: {
                embedding: {
                  nativeType: 'vector(1536)',
                  codecId: 'pg/vector@1',
                  nullable: false,
                  typeRef: 'Embedding1536',
                },
              },
              primaryKey: { columns: [] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          types: {
            Embedding1536: {
              codecId: 'pg/vector@1',
              nativeType: 'vector(1536)',
              typeParams: { length: 1536 },
            },
          },
        },
      });

      const vectorRenderer: TypeRenderEntry = {
        codecId: 'pg/vector@1',
        render: (params) => `Vector<${params['length']}>`,
      };

      const parameterizedRenderers = new Map<string, TypeRenderEntry>();
      parameterizedRenderers.set('pg/vector@1', vectorRenderer);

      const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], {
        parameterizedRenderers,
      });

      expect(types).toContain('readonly embedding: Vector<1536>');
    });
  });

  describe('deterministic output ordering', () => {
    it('emits multiple parameterized types in deterministic column order', () => {
      const ir = createContractIR({
        models: {
          Document: {
            storage: { table: 'document' },
            fields: {
              embedding1: { column: 'embedding1' },
              embedding2: { column: 'embedding2' },
              embedding3: { column: 'embedding3' },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            document: {
              columns: {
                embedding3: {
                  nativeType: 'vector(768)',
                  codecId: 'pg/vector@1',
                  nullable: false,
                  typeParams: { length: 768 },
                },
                embedding1: {
                  nativeType: 'vector(1536)',
                  codecId: 'pg/vector@1',
                  nullable: false,
                  typeParams: { length: 1536 },
                },
                embedding2: {
                  nativeType: 'vector(384)',
                  codecId: 'pg/vector@1',
                  nullable: false,
                  typeParams: { length: 384 },
                },
              },
              primaryKey: { columns: [] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      const vectorRenderer: TypeRenderEntry = {
        codecId: 'pg/vector@1',
        render: (params) => `Vector<${params['length']}>`,
      };

      const parameterizedRenderers = new Map<string, TypeRenderEntry>();
      parameterizedRenderers.set('pg/vector@1', vectorRenderer);

      // Generate twice to ensure determinism
      const types1 = sqlTargetFamilyHook.generateContractTypes(ir, [], [], {
        parameterizedRenderers,
      });
      const types2 = sqlTargetFamilyHook.generateContractTypes(ir, [], [], {
        parameterizedRenderers,
      });

      // Output should be identical
      expect(types1).toBe(types2);

      // Model fields should follow the model.fields order (embedding1, embedding2, embedding3)
      expect(types1).toContain('readonly embedding1: Vector<1536>');
      expect(types1).toContain('readonly embedding2: Vector<384>');
      expect(types1).toContain('readonly embedding3: Vector<768>');
    });
  });

  describe('edge cases', () => {
    it('handles columns with typeParams but no matching renderer', () => {
      const ir = createContractIR({
        models: {
          Data: {
            storage: { table: 'data' },
            fields: {
              value: { column: 'value' },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            data: {
              columns: {
                value: {
                  nativeType: 'custom',
                  codecId: 'custom/type@1',
                  nullable: false,
                  typeParams: { foo: 'bar' },
                },
              },
              primaryKey: { columns: [] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      // No renderer registered for custom/type@1
      const parameterizedRenderers = new Map<string, TypeRenderEntry>();

      const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], {
        parameterizedRenderers,
      });

      // Should fall back to standard codec types lookup
      expect(types).toContain("readonly value: CodecTypes['custom/type@1']['output']");
    });

    it('handles typeRef pointing to non-existent storage.types entry gracefully', () => {
      const ir = createContractIR({
        models: {
          Data: {
            storage: { table: 'data' },
            fields: {
              value: { column: 'value' },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            data: {
              columns: {
                value: {
                  nativeType: 'vector',
                  codecId: 'pg/vector@1',
                  nullable: false,
                  typeRef: 'NonExistent',
                },
              },
              primaryKey: { columns: [] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          types: {},
        },
      });

      const vectorRenderer: TypeRenderEntry = {
        codecId: 'pg/vector@1',
        render: (params) => `Vector<${params['length']}>`,
      };

      const parameterizedRenderers = new Map<string, TypeRenderEntry>();
      parameterizedRenderers.set('pg/vector@1', vectorRenderer);

      const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], {
        parameterizedRenderers,
      });

      // Should fall back to standard codec types lookup when typeRef doesn't resolve
      expect(types).toContain("readonly value: CodecTypes['pg/vector@1']['output']");
    });

    it('handles empty typeParams object by falling back to standard lookup', () => {
      const ir = createContractIR({
        models: {
          Data: {
            storage: { table: 'data' },
            fields: {
              value: { column: 'value' },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            data: {
              columns: {
                value: {
                  nativeType: 'vector',
                  codecId: 'pg/vector@1',
                  nullable: false,
                  typeParams: {},
                },
              },
              primaryKey: { columns: [] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      const vectorRenderer: TypeRenderEntry = {
        codecId: 'pg/vector@1',
        render: (params) => `Vector<${params['length']}>`,
      };

      const parameterizedRenderers = new Map<string, TypeRenderEntry>();
      parameterizedRenderers.set('pg/vector@1', vectorRenderer);

      const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], {
        parameterizedRenderers,
      });

      // Empty typeParams means "no params" - fall back to standard codec lookup
      expect(types).toContain("readonly value: CodecTypes['pg/vector@1']['output']");
    });

    it('works without options parameter (backwards compatibility)', () => {
      const ir = createContractIR({
        models: {
          User: {
            storage: { table: 'user' },
            fields: {
              id: { column: 'id' },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      // Call without options (4th parameter)
      const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);

      expect(types).toContain("readonly id: CodecTypes['pg/int4@1']['output']");
    });
  });
});
