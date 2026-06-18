import { startPrismaDevServer } from '@prisma/dev';
import { Client } from 'pg';
import { describe, expect, test } from 'vitest';
import { compileWorkflowSchema } from '../src/compiler/compile';
import { renderWorkflowSqlDdl } from '../src/compiler/sql-ddl';
import { createWorkflowRuntime } from '../src/runtime/engine';
import { PostgresWorkflowStore } from '../src/runtime/postgres-store';

function normalizeConnectionString(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === 'localhost' || url.hostname === '::1') {
    url.hostname = '127.0.0.1';
  }
  return url.toString();
}

describe('workflow DDL on @prisma/dev Postgres', () => {
  test('creates the durable workflow runtime tables', async () => {
    const server = await startPrismaDevServer({
      databaseConnectTimeoutMillis: 1000,
      databaseIdleTimeoutMillis: 1000,
    });
    const client = new Client({
      connectionString: normalizeConnectionString(server.database.connectionString),
    });

    try {
      await client.connect();
      await client.query(renderWorkflowSqlDdl());
      const tables = await client.query<{ table_name: string }>(
        `select table_name
         from information_schema.tables
         where table_schema = '_prisma_workflows'
         order by table_name`,
      );

      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'WorkflowApproval',
        'WorkflowArtifact',
        'WorkflowCanvasLayout',
        'WorkflowConnectorAccount',
        'WorkflowConnectorCursor',
        'WorkflowDeadLetter',
        'WorkflowDefinition',
        'WorkflowIngestEvent',
        'WorkflowLease',
        'WorkflowOutbox',
        'WorkflowRun',
        'WorkflowStateSnapshot',
        'WorkflowStepRun',
        'WorkflowTimelineEvent',
        'WorkflowTimer',
        'WorkflowTriggerMatch',
        'WorkflowVersion',
      ]);
    } finally {
      await client.end().catch(() => {});
      await server.close();
    }
  });

  test('persists ingest, runs, steps, timeline, and dedupe through Postgres store', async () => {
    const server = await startPrismaDevServer({
      databaseConnectTimeoutMillis: 1000,
      databaseIdleTimeoutMillis: 1000,
    });
    const store = new PostgresWorkflowStore({
      connectionString: normalizeConnectionString(server.database.connectionString),
    });

    try {
      const compiled = compileWorkflowSchema({
        sourceId: 'schema.prisma',
        schema: `
workflow DurableReview {
  trigger eventCreated {
    source = "stripe"
    event = "event.created"
    dedupeBy = "event.id"
  }

  step record {
    run = "./record.ts"
  }
}
`,
      });
      const runtime = createWorkflowRuntime({
        manifest: compiled.manifest,
        store,
        steps: {
          record: () => ({ persisted: true }),
        },
      });

      const first = await runtime.ingest({
        source: 'stripe',
        eventType: 'event.created',
        connectorAccountId: 'acct_a',
        payload: { id: 'evt_pg' },
      });
      const duplicate = await runtime.ingest({
        source: 'stripe',
        eventType: 'event.created',
        connectorAccountId: 'acct_a',
        payload: { id: 'evt_pg' },
      });
      const [completed] = await runtime.runUntilIdle();
      const snapshot = await runtime.snapshot();

      expect(first.duplicate).toBe(false);
      expect(duplicate.duplicate).toBe(true);
      expect(completed?.status).toBe('completed');
      expect(snapshot.definitions).toHaveLength(1);
      expect(snapshot.versions).toHaveLength(1);
      expect(snapshot.ingestEvents).toHaveLength(1);
      expect(snapshot.runs[0]?.state).toMatchObject({ persisted: true });
      expect(snapshot.steps[0]).toMatchObject({ stepName: 'record', status: 'completed' });
      expect(snapshot.timeline.map((event) => event.type)).toEqual(
        expect.arrayContaining(['INGEST_MATCHED', 'STEP_COMPLETED', 'RUN_COMPLETED']),
      );
    } finally {
      await store.close().catch(() => {});
      await server.close();
    }
  });

  test('deduplicates concurrent ingest and creates one durable run', async () => {
    const server = await startPrismaDevServer({
      databaseConnectTimeoutMillis: 1000,
      databaseIdleTimeoutMillis: 1000,
    });
    const store = new PostgresWorkflowStore({
      connectionString: normalizeConnectionString(server.database.connectionString),
    });

    try {
      const compiled = compileWorkflowSchema({
        sourceId: 'schema.prisma',
        schema: `
workflow ConcurrentIngest {
  trigger eventCreated {
    source = "stripe"
    event = "event.created"
    dedupeBy = "event.id"
  }

  step record {
    run = "./record.ts"
  }
}
`,
      });
      const runtime = createWorkflowRuntime({
        manifest: compiled.manifest,
        store,
        steps: {
          record: () => ({ persisted: true }),
        },
      });

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          runtime.ingest({
            source: 'stripe',
            eventType: 'event.created',
            connectorAccountId: 'acct_a',
            payload: { id: 'evt_race' },
          }),
        ),
      );
      await runtime.runUntilIdle();
      const snapshot = await runtime.snapshot();

      expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
      expect(results.filter((result) => result.duplicate)).toHaveLength(7);
      expect(snapshot.ingestEvents).toHaveLength(1);
      expect(snapshot.triggerMatches).toHaveLength(1);
      expect(snapshot.runs).toHaveLength(1);
      expect(snapshot.runs[0]?.status).toBe('completed');
    } finally {
      await store.close().catch(() => {});
      await server.close();
    }
  });

  test('reclaims an expired lease for a crashed running run', async () => {
    const server = await startPrismaDevServer({
      databaseConnectTimeoutMillis: 1000,
      databaseIdleTimeoutMillis: 1000,
    });
    const store = new PostgresWorkflowStore({
      connectionString: normalizeConnectionString(server.database.connectionString),
    });

    try {
      const compiled = compileWorkflowSchema({
        sourceId: 'schema.prisma',
        schema: `
workflow LeaseRecovery {
  step record {
    run = "./record.ts"
  }
}
`,
      });
      const firstRuntime = createWorkflowRuntime({
        manifest: compiled.manifest,
        store,
        workerId: 'dead_worker',
        steps: {
          record: () => ({ recovered: false }),
        },
      });
      const run = await firstRuntime.enqueue('LeaseRecovery', { id: 'evt_reclaim' });
      const claimed = await store.claimNextRun({
        workerId: 'dead_worker',
        ttlMs: 1,
        now: new Date(0),
      });
      await store.updateRun(run.id, {
        status: 'running',
        currentNode: 'step:record',
        startedAt: new Date(0),
      });
      const recoveryRuntime = createWorkflowRuntime({
        manifest: compiled.manifest,
        store,
        workerId: 'recovery_worker',
        steps: {
          record: () => ({ recovered: true }),
        },
      });

      const recovered = await recoveryRuntime.runNext();

      expect(claimed?.id).toBe(run.id);
      expect(recovered?.status).toBe('completed');
      expect(recovered?.state).toMatchObject({ recovered: true });
    } finally {
      await store.close().catch(() => {});
      await server.close();
    }
  });
});
