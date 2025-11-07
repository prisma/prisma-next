import type { ContractIR } from '@prisma-next/emitter';
import { describe, expect, it } from 'vitest';
import { sqlTargetFamilyHook } from '../src/emitter-hook';

describe('sql-target-family-hook', () => {
  it('validates SQL structure', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'sql/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).not.toThrow();
  });

  it('throws error for invalid structure', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'nonexistent' },
          fields: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow();
  });

  it('validates structure with model field missing column property', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: {},
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing column property');
  });

  it('validates structure with missing targetFamily', () => {
    const ir: ContractIR = {
      target: 'test-db',
      targetFamily: undefined as unknown as string,
      storage: {
        tables: {},
      },
    } as ContractIR;

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('Expected targetFamily "sql"');
  });

  it('validates structure with missing storage', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('SQL contract must have storage.tables');
  });

  it('validates structure with missing storage.tables', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {},
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('SQL contract must have storage.tables');
  });

  it('validates structure with model missing storage.table', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          fields: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing storage.table');
  });

  it('validates structure with model referencing non-existent table', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'nonexistent' },
          fields: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('references non-existent table');
  });

  it('validates structure with model table missing primary key', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing a primary key');
  });

  it('validates structure with model field referencing non-existent column', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'nonexistent' },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('references non-existent column');
  });

  it('validates structure with missing model fields', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing fields');
  });

  it('validates structure with primaryKey referencing non-existent column', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['nonexistent'] },
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('primaryKey references non-existent column');
  });

  it('validates structure with unique constraint referencing non-existent column', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['nonexistent'] }],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('unique constraint references non-existent column');
  });

  it('validates structure with index referencing non-existent column', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            indexes: [{ columns: ['nonexistent'] }],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('index references non-existent column');
  });

  it('validates structure with foreignKey referencing non-existent column', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['nonexistent'],
                references: { table: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('foreignKey references non-existent column');
  });

  it('validates structure with foreignKey referencing non-existent table', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'nonexistent', columns: ['id'] },
              },
            ],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('foreignKey references non-existent table');
  });

  it('validates structure with foreignKey referencing non-existent referenced column', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['nonexistent'] },
              },
            ],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('foreignKey references non-existent column');
  });

  it('validates structure with foreignKey column count mismatch', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id', 'id'] },
              },
            ],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('column count');
  });
});

