import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import { profileHash } from '@prisma-next/contract/types';
import type {
  ImportRequirement,
  MigrationOperationClass,
  OpFactoryCall,
} from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { planFieldEventOperations } from '../src/core/migrations/field-event-planner';
import type {
  CodecControlHooks,
  FieldEventContext,
  SqlMigrationPlanOperation,
} from '../src/core/migrations/types';

type Op = SqlMigrationPlanOperation<unknown>;

function col(overrides: Partial<StorageColumn> & { codecId: string }): StorageColumn {
  return {
    nativeType: 'text',
    nullable: false,
    ...overrides,
  };
}

function table(columns: Record<string, StorageColumn>): StorageTable {
  return {
    columns,
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

function contract(tables: Record<string, StorageTable>): Contract<SqlStorage> {
  const storage: SqlStorage = {
    storageHash: 'sha256:test' as StorageHashBase<string>,
    tables,
  };
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage,
    models: {},
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function makeOp(id: string, label = id): Op {
  return {
    id,
    label,
    operationClass: 'additive',
    invariantId: `inv:${id}`,
    target: { id: 'postgres' },
    precheck: [],
    execute: [{ description: label, sql: `-- ${id}` }],
    postcheck: [],
  };
}

/**
 * Test-only `OpFactoryCall` stub. Wraps a stub op (`makeOp`) so the
 * existing assertion shape (`calls.map((c) => c.toOp().id)`) keeps
 * working after the planner started returning Calls instead of raw ops.
 */
class StubCall implements OpFactoryCall {
  readonly factoryName = 'stub' as const;
  readonly operationClass: MigrationOperationClass = 'additive';
  readonly label: string;

  constructor(private readonly op: Op) {
    this.label = op.label;
  }

  toOp(): Op {
    return this.op;
  }

  renderTypeScript(): string {
    return `stub(${JSON.stringify(this.op.id)})`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

function makeCall(id: string, label = id): StubCall {
  return new StubCall(makeOp(id, label));
}

interface RecordedCall {
  readonly event: 'added' | 'dropped' | 'altered';
  readonly tableName: string;
  readonly fieldName: string;
  readonly priorCodecId: string | undefined;
  readonly newCodecId: string | undefined;
  readonly priorTablePresent: boolean;
  readonly newTablePresent: boolean;
}

function recordingHook(
  callsPerEvent: readonly OpFactoryCall[] | ((call: RecordedCall) => readonly OpFactoryCall[]),
): {
  readonly hook: CodecControlHooks;
  readonly calls: readonly RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const hook: CodecControlHooks = {
    onFieldEvent: (event, ctx: FieldEventContext) => {
      const recorded: RecordedCall = {
        event,
        tableName: ctx.tableName,
        fieldName: ctx.fieldName,
        priorCodecId: ctx.priorField?.codecId,
        newCodecId: ctx.newField?.codecId,
        priorTablePresent: ctx.priorTable !== undefined,
        newTablePresent: ctx.newTable !== undefined,
      };
      calls.push(recorded);
      return typeof callsPerEvent === 'function' ? callsPerEvent(recorded) : callsPerEvent;
    },
  };
  return { hook, calls };
}

describe('planFieldEventOperations', () => {
  it("fires 'added' once per added field on the new field's codec", () => {
    const fromContract = contract({
      User: table({ id: col({ codecId: 'pg/text@1' }) }),
    });
    const newContract = contract({
      User: table({
        id: col({ codecId: 'pg/text@1' }),
        email: col({ codecId: 'cs/string@1' }),
      }),
    });

    const cs = recordingHook([makeCall('add-search-config-User-email')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(cs.calls).toEqual([
      {
        event: 'added',
        tableName: 'User',
        fieldName: 'email',
        priorCodecId: undefined,
        newCodecId: 'cs/string@1',
        priorTablePresent: false,
        newTablePresent: true,
      },
    ]);
    expect(ops.map((c) => c.toOp().id)).toEqual(['add-search-config-User-email']);
  });

  it("fires 'dropped' once per dropped field on the prior field's codec", () => {
    const fromContract = contract({
      User: table({
        id: col({ codecId: 'pg/text@1' }),
        email: col({ codecId: 'cs/string@1' }),
      }),
    });
    const newContract = contract({
      User: table({ id: col({ codecId: 'pg/text@1' }) }),
    });

    const cs = recordingHook([makeCall('remove-search-config-User-email')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(cs.calls).toEqual([
      {
        event: 'dropped',
        tableName: 'User',
        fieldName: 'email',
        priorCodecId: 'cs/string@1',
        newCodecId: undefined,
        priorTablePresent: true,
        newTablePresent: false,
      },
    ]);
    expect(ops.map((c) => c.toOp().id)).toEqual(['remove-search-config-User-email']);
  });

  it("fires 'altered' when nullable changes", () => {
    const fromContract = contract({
      User: table({ email: col({ codecId: 'cs/string@1', nullable: true }) }),
    });
    const newContract = contract({
      User: table({ email: col({ codecId: 'cs/string@1', nullable: false }) }),
    });

    const cs = recordingHook([makeCall('rotate')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(cs.calls).toHaveLength(1);
    expect(cs.calls[0]?.event).toBe('altered');
    expect(cs.calls[0]?.priorTablePresent).toBe(true);
    expect(cs.calls[0]?.newTablePresent).toBe(true);
    expect(ops).toHaveLength(1);
  });

  it("fires 'altered' when typeParams change", () => {
    const fromContract = contract({
      User: table({
        email: col({ codecId: 'cs/string@1', typeParams: { searchable: false } }),
      }),
    });
    const newContract = contract({
      User: table({
        email: col({ codecId: 'cs/string@1', typeParams: { searchable: true } }),
      }),
    });

    const cs = recordingHook([makeCall('rotate')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(cs.calls.map((c) => c.event)).toEqual(['altered']);
    expect(ops).toHaveLength(1);
  });

  it("fires 'altered' when the default value changes", () => {
    const fromContract = contract({
      User: table({
        flag: col({ codecId: 'cs/string@1', default: { kind: 'literal', value: 'a' } }),
      }),
    });
    const newContract = contract({
      User: table({
        flag: col({ codecId: 'cs/string@1', default: { kind: 'literal', value: 'b' } }),
      }),
    });

    const cs = recordingHook([makeCall('rotate')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(cs.calls.map((c) => c.event)).toEqual(['altered']);
    expect(ops).toHaveLength(1);
  });

  it("does not fire 'altered' when only codecId changes", () => {
    const fromContract = contract({
      User: table({ email: col({ codecId: 'pg/text@1' }) }),
    });
    const newContract = contract({
      User: table({ email: col({ codecId: 'pg/varchar@1' }) }),
    });

    const text = recordingHook([makeCall('text')]);
    const varchar = recordingHook([makeCall('varchar')]);
    const codecHooks = new Map<string, CodecControlHooks>([
      ['pg/text@1', text.hook],
      ['pg/varchar@1', varchar.hook],
    ]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(text.calls).toHaveLength(0);
    expect(varchar.calls).toHaveLength(0);
    expect(ops).toHaveLength(0);
  });

  it("does not fire 'altered' on a no-op diff (fields byte-equal)", () => {
    const same = contract({
      User: table({ email: col({ codecId: 'cs/string@1', nullable: false }) }),
    });

    const cs = recordingHook([makeCall('rotate')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: same,
      newContract: same,
      codecHooks,
    });

    expect(cs.calls).toHaveLength(0);
    expect(ops).toHaveLength(0);
  });

  it('treats a missing prior contract as "everything is added"', () => {
    const newContract = contract({
      User: table({
        id: col({ codecId: 'pg/text@1' }),
        email: col({ codecId: 'cs/string@1' }),
      }),
    });

    const cs = recordingHook([makeCall('add-search-config')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: null,
      newContract,
      codecHooks,
    });

    expect(cs.calls.map((c) => c.event)).toEqual(['added']);
    expect(cs.calls[0]?.tableName).toBe('User');
    expect(cs.calls[0]?.fieldName).toBe('email');
    expect(ops).toHaveLength(1);
  });

  it('does nothing when the codec has no onFieldEvent hook', () => {
    const fromContract = contract({ User: table({}) });
    const newContract = contract({
      User: table({ email: col({ codecId: 'pg/text@1' }) }),
    });

    const codecHooks = new Map<string, CodecControlHooks>([
      ['pg/text@1', { planTypeOperations: () => ({ operations: [] }) }],
    ]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(ops).toHaveLength(0);
  });

  it('does nothing when no hook is registered for the field codec', () => {
    const fromContract = contract({ User: table({}) });
    const newContract = contract({
      User: table({ email: col({ codecId: 'pg/text@1' }) }),
    });

    const codecHooks = new Map<string, CodecControlHooks>();

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(ops).toHaveLength(0);
  });

  it('returns the hook ops in the order the hook returned them', () => {
    const fromContract = contract({ User: table({}) });
    const newContract = contract({
      User: table({ email: col({ codecId: 'cs/string@1' }) }),
    });

    const cs = recordingHook([makeCall('first'), makeCall('second'), makeCall('third')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(ops.map((c) => c.toOp().id)).toEqual(['first', 'second', 'third']);
  });

  it('returns an empty list when the hook returns an empty array', () => {
    const fromContract = contract({ User: table({}) });
    const newContract = contract({
      User: table({ email: col({ codecId: 'cs/string@1' }) }),
    });

    const cs = recordingHook([]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(cs.calls).toHaveLength(1);
    expect(ops).toHaveLength(0);
  });

  it('groups events deterministically: added → dropped → altered', () => {
    const fromContract = contract({
      User: table({
        toAlter: col({ codecId: 'cs/string@1', nullable: true }),
        toDrop: col({ codecId: 'cs/string@1' }),
      }),
    });
    const newContract = contract({
      User: table({
        toAdd: col({ codecId: 'cs/string@1' }),
        toAlter: col({ codecId: 'cs/string@1', nullable: false }),
      }),
    });

    const cs = recordingHook((call) => [makeCall(`${call.event}:${call.fieldName}`)]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(cs.calls.map((c) => c.event)).toEqual(['added', 'dropped', 'altered']);
    expect(ops.map((c) => c.toOp().id)).toEqual([
      'added:toAdd',
      'dropped:toDrop',
      'altered:toAlter',
    ]);
  });

  it('orders events within a group alphabetically by (tableName, fieldName)', () => {
    const fromContract = contract({});
    const newContract = contract({
      Beta: table({
        zeta: col({ codecId: 'cs/string@1' }),
        alpha: col({ codecId: 'cs/string@1' }),
      }),
      Alpha: table({
        beta: col({ codecId: 'cs/string@1' }),
        zeta: col({ codecId: 'cs/string@1' }),
      }),
    });

    const cs = recordingHook((_call) => []);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(cs.calls.map((c) => `${c.tableName}.${c.fieldName}`)).toEqual([
      'Alpha.beta',
      'Alpha.zeta',
      'Beta.alpha',
      'Beta.zeta',
    ]);
  });

  it('routes each event to the codec that owns the field, not other codecs', () => {
    const fromContract = contract({ User: table({}) });
    const newContract = contract({
      User: table({
        secret: col({ codecId: 'cs/string@1' }),
        plain: col({ codecId: 'pg/text@1' }),
      }),
    });

    const cs = recordingHook([makeCall('cs-add')]);
    const pg = recordingHook([makeCall('pg-add')]);
    const codecHooks = new Map<string, CodecControlHooks>([
      ['cs/string@1', cs.hook],
      ['pg/text@1', pg.hook],
    ]);

    planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(cs.calls.map((c) => c.fieldName)).toEqual(['secret']);
    expect(pg.calls.map((c) => c.fieldName)).toEqual(['plain']);
  });

  it('produces byte-stable output across repeated calls (deterministic ordering)', () => {
    const fromContract = contract({
      User: table({
        toAlter: col({ codecId: 'cs/string@1', nullable: true }),
        toDrop: col({ codecId: 'cs/string@1' }),
      }),
    });
    const newContract = contract({
      Post: table({ body: col({ codecId: 'cs/string@1' }) }),
      User: table({
        toAdd: col({ codecId: 'cs/string@1' }),
        toAlter: col({ codecId: 'cs/string@1', nullable: false }),
      }),
    });

    const codecHooks = new Map<string, CodecControlHooks>([
      [
        'cs/string@1',
        {
          onFieldEvent: (event, ctx) => [makeCall(`op-${event}-${ctx.tableName}-${ctx.fieldName}`)],
        },
      ],
    ]);

    const opsA = planFieldEventOperations({ priorContract: fromContract, newContract, codecHooks });
    const opsB = planFieldEventOperations({ priorContract: fromContract, newContract, codecHooks });

    expect(JSON.stringify(opsA)).toBe(JSON.stringify(opsB));
  });

  it('handles whole-table additions and drops by treating each field as its own event', () => {
    const fromContract = contract({
      Drop: table({
        a: col({ codecId: 'cs/string@1' }),
        b: col({ codecId: 'cs/string@1' }),
      }),
    });
    const newContract = contract({
      Add: table({
        x: col({ codecId: 'cs/string@1' }),
        y: col({ codecId: 'cs/string@1' }),
      }),
    });

    const cs = recordingHook((call) => [
      makeCall(`${call.event}:${call.tableName}.${call.fieldName}`),
    ]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
    });

    expect(ops.map((c) => c.toOp().id)).toEqual([
      'added:Add.x',
      'added:Add.y',
      'dropped:Drop.a',
      'dropped:Drop.b',
    ]);
  });
});
