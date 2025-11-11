import { describe, expect, it } from 'vitest';
import {
  createSqlOperationRegistry,
  register,
  type SqlOperationSignature,
} from '../src/index';

describe('SQL OperationRegistry', () => {
  it('registers operation with SQL lowering spec', () => {
    const registry = createSqlOperationRegistry();
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    register(registry, signature);
    const operations = registry.byType('pg/vector@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'infix',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
      template: '${self} <=> ${arg0}',
    });
  });

  it('supports function strategy lowering', () => {
    const registry = createSqlOperationRegistry();
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'normalize',
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    register(registry, signature);
    const operations = registry.byType('pg/vector@1');
    expect(operations[0]?.lowering.strategy).toBe('function');
  });
});
