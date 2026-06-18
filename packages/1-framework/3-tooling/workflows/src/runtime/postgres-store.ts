import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';
import { workflowVersionId } from '../shared/path';
import {
  quoteWorkflowSqlIdentifier,
  renderWorkflowSqlDdl,
  WORKFLOW_SCHEMA_NAME,
} from '../shared/sql-ddl';
import type {
  WorkflowApprovalRecord,
  WorkflowArtifactRecord,
  WorkflowCanvasLayoutRecord,
  WorkflowConnectorAccountRecord,
  WorkflowConnectorCursorRecord,
  WorkflowDeadLetterRecord,
  WorkflowDefinitionIR,
  WorkflowDefinitionRecord,
  WorkflowIngestEventRecord,
  WorkflowLeaseRecord,
  WorkflowOutboxRecord,
  WorkflowRunRecord,
  WorkflowStateSnapshotRecord,
  WorkflowStepRunRecord,
  WorkflowStoreSnapshot,
  WorkflowTimelineEventRecord,
  WorkflowTimerRecord,
  WorkflowTriggerMatchRecord,
  WorkflowVersionRecord,
} from '../shared/types';
import type {
  ClaimApprovalRunInput,
  ClaimNextOutboxAndRunInput,
  ClaimNextOutboxInput,
  ClaimNextRunInput,
  ClaimRunInput,
  CreateRunWithTimelineAndSnapshotInput,
  CreateRunWithTimelineInput,
  ExtendWorkflowLeaseInput,
  InspectWorkflowRunInput,
  LeasedApprovalCreateInput,
  LeasedApprovalResolveInput,
  LeasedApprovalRunUpdateInput,
  LeasedApprovalWaitInput,
  LeasedCompletedStepCreateInput,
  LeasedDeadLetterCreateInput,
  LeasedExternalStepOutboxPauseInput,
  LeasedOutboxCreateInput,
  LeasedOutboxDispatchCompletionInput,
  LeasedOutboxTimelineUpdateInput,
  LeasedOutboxUpdateInput,
  LeasedReplayWaitSupersedeInput,
  LeasedRunUpdateInput,
  LeasedSnapshotAppendInput,
  LeasedStepCompletionInput,
  LeasedStepRetryScheduleInput,
  LeasedStepRunCreateInput,
  LeasedStepRunStartInput,
  LeasedStepRunUpdateInput,
  LeasedTimelineAppendInput,
  LeasedTimelineRunUpdateInput,
  LeasedTimerCreateInput,
  LeasedTimerUpdateInput,
  ResolveApprovalIfPendingInput,
  WorkflowApprovalRunClaim,
  WorkflowExternalStepOutboxPauseResult,
  WorkflowIngestAndCreateRunsInput,
  WorkflowIngestAndCreateRunsResult,
  WorkflowLeaseGuardInput,
  WorkflowOutboxClaim,
  WorkflowOutboxRunClaim,
  WorkflowRunClaim,
  WorkflowRunInspection,
  WorkflowStore,
} from './store';

export interface PostgresWorkflowStoreOptions {
  readonly connectionString?: string;
  readonly pool?: Pool;
  readonly schemaName?: string;
  readonly autoMigrate?: boolean;
}

const CLAIMABLE_RUN_STATUSES: readonly WorkflowRunRecord['status'][] = [
  'queued',
  'running',
  'paused',
  'waiting_for_approval',
  'waiting_for_timer',
];

export class PostgresWorkflowStore implements WorkflowStore {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #schemaName: string;
  readonly #schema: string;
  readonly #ready: Promise<void>;

  constructor(options: PostgresWorkflowStoreOptions = {}) {
    this.#schemaName = options.schemaName ?? WORKFLOW_SCHEMA_NAME;
    this.#schema = quoteWorkflowSqlIdentifier(this.#schemaName);
    this.#pool = options.pool ?? new Pool({ connectionString: options.connectionString });
    this.#pool.on('error', () => {});
    this.#ownsPool = options.pool === undefined;
    this.#ready = options.autoMigrate === false ? Promise.resolve() : this.migrate();
  }

  async migrate(): Promise<void> {
    await this.#pool.query(renderWorkflowSqlDdl(this.#schemaName));
  }

  async close(): Promise<void> {
    if (this.#ownsPool) {
      await this.#pool.end();
    }
  }

  async upsertDefinitions(workflows: readonly WorkflowDefinitionIR[]): Promise<void> {
    await this.#withClient(async (client) => {
      await client.query('begin');
      try {
        for (const workflow of workflows) {
          await client.query(
            `insert into ${this.#schema}."WorkflowDefinition" (id, name, slug, created_at, updated_at)
             values ($1, $2, $3, now(), now())
             on conflict (id) do update set name = excluded.name, slug = excluded.slug, updated_at = now()`,
            [workflow.id, workflow.name, workflow.slug],
          );
          const versionId = workflowVersionId(workflow);
          await client.query(
            `update ${this.#schema}."WorkflowVersion"
             set status = 'retired'
             where workflow_id = $1 and id <> $2`,
            [workflow.id, versionId],
          );
          await client.query(
            `insert into ${this.#schema}."WorkflowVersion"
               (id, workflow_id, version, status, source_hash, compiled_graph, visual_graph, created_at)
             values ($1, $2, $3, 'active', $4, $5, $6, now())
             on conflict (id) do update set status = 'active'`,
            [
              versionId,
              workflow.id,
              workflow.version,
              workflow.sourceHash,
              workflow,
              workflow.canvas,
            ],
          );
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });
  }

  async snapshot(): Promise<WorkflowStoreSnapshot> {
    return this.#withClient(async (client) => ({
      definitions: (
        await client.query(`${selectDefinitions(this.#schema)} order by created_at`)
      ).rows.map(definitionFromRow),
      versions: (
        await client.query(`${selectVersions(this.#schema)} order by created_at`)
      ).rows.map(versionFromRow),
      ingestEvents: (
        await client.query(`${selectIngestEvents(this.#schema)} order by received_at`)
      ).rows.map(ingestEventFromRow),
      triggerMatches: (
        await client.query(`${selectTriggerMatches(this.#schema)} order by created_at`)
      ).rows.map(triggerMatchFromRow),
      runs: (await client.query(`${selectRuns(this.#schema)} order by created_at`)).rows.map(
        runFromRow,
      ),
      steps: (await client.query(`${selectStepRuns(this.#schema)} order by created_at`)).rows.map(
        stepRunFromRow,
      ),
      timeline: (
        await client.query(`${selectTimeline(this.#schema)} order by run_id, sequence`)
      ).rows.map(timelineFromRow),
      snapshots: (
        await client.query(`${selectStateSnapshots(this.#schema)} order by run_id, sequence`)
      ).rows.map(stateSnapshotFromRow),
      approvals: (
        await client.query(`${selectApprovals(this.#schema)} order by requested_at`)
      ).rows.map(approvalFromRow),
      leases: (await client.query(`${selectLeases(this.#schema)} order by heartbeat_at`)).rows.map(
        leaseFromRow,
      ),
      timers: (await client.query(`${selectTimers(this.#schema)} order by created_at`)).rows.map(
        timerFromRow,
      ),
      outbox: (await client.query(`${selectOutbox(this.#schema)} order by created_at`)).rows.map(
        outboxFromRow,
      ),
      deadLetters: (
        await client.query(`${selectDeadLetters(this.#schema)} order by created_at`)
      ).rows.map(deadLetterFromRow),
      connectorAccounts: (
        await client.query(`${selectConnectorAccounts(this.#schema)} order by created_at`)
      ).rows.map(connectorAccountFromRow),
      connectorCursors: (
        await client.query(`${selectConnectorCursors(this.#schema)} order by updated_at`)
      ).rows.map(connectorCursorFromRow),
      canvasLayouts: (
        await client.query(`${selectCanvasLayouts(this.#schema)} order by updated_at`)
      ).rows.map(canvasLayoutFromRow),
      artifacts: (
        await client.query(`${selectArtifacts(this.#schema)} order by created_at`)
      ).rows.map(artifactFromRow),
    }));
  }

  async findWorkflowByName(name: string): Promise<WorkflowDefinitionIR | undefined> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `select v.id, v.workflow_id, v.version, v.status, v.source_hash, v.compiled_graph, v.visual_graph, v.created_at
         from ${this.#schema}."WorkflowVersion" v
         join ${this.#schema}."WorkflowDefinition" d on d.id = v.workflow_id
         where d.name = $1 and v.status = 'active'
         order by v.created_at desc
         limit 1`,
        [name],
      );
      return result.rows[0] ? versionFromRow(result.rows[0]).compiledGraph : undefined;
    });
  }

  async findWorkflowVersion(versionId: string): Promise<WorkflowVersionRecord | undefined> {
    return this.#withClient(async (client) => {
      const result = await client.query(`${selectVersions(this.#schema)} where id = $1`, [
        versionId,
      ]);
      return result.rows[0] ? versionFromRow(result.rows[0]) : undefined;
    });
  }

  async findWorkflowByTrigger(
    source: string,
    eventType: string,
  ): Promise<readonly WorkflowDefinitionIR[]> {
    const snapshot = await this.snapshot();
    return snapshot.versions
      .filter((version) => version.status === 'active')
      .map((version) => version.compiledGraph)
      .filter((workflow) =>
        workflow.triggers.some(
          (trigger) => trigger.source === source && trigger.event === eventType,
        ),
      );
  }

  async createIngestEvent(
    event: Omit<WorkflowIngestEventRecord, 'id' | 'receivedAt'>,
  ): Promise<WorkflowIngestEventRecord> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `${insertIngestEvent(this.#schema)}
         on conflict (dedupe_key) do update set dedupe_key = excluded.dedupe_key
         returning *`,
        [
          id('evt'),
          event.source,
          event.connectorAccountId ?? null,
          event.externalId,
          event.eventType,
          event.dedupeKey,
          event.occurredAt ?? null,
          event.headers ?? null,
          event.rawPayload,
          event.normalizedPayload ?? null,
          event.signatureVerified,
          event.status,
          event.error ?? null,
        ],
      );
      return ingestEventFromRow(requireRow(result.rows[0]));
    });
  }

  async ingestEventAndCreateRuns(
    input: WorkflowIngestAndCreateRunsInput,
  ): Promise<WorkflowIngestAndCreateRunsResult> {
    return this.#withClient(async (client) => {
      if (input.runs.length === 1) {
        const run = input.runs[0];
        if (!run) {
          throw new Error('Expected one workflow run for single-run ingest fast path.');
        }
        const result = await client.query(
          `with inserted_event as (
	             ${insertIngestEvent(this.#schema)}
	             on conflict (dedupe_key) do update set dedupe_key = excluded.dedupe_key
	             returning *, (xmax = 0) as inserted
	           ),
	           inserted_match as (
	             insert into ${this.#schema}."WorkflowTriggerMatch"
	               (id, ingest_event_id, workflow_id, version_id, created_at)
	             select $14, inserted_event.id, $15, $16, now()
	             from inserted_event
	             where inserted_event.inserted
	             on conflict (ingest_event_id, workflow_id, version_id) do nothing
	             returning ingest_event_id
	           ),
           inserted_run as (
             insert into ${this.#schema}."WorkflowRun"
               (id, workflow_id, version_id, ingest_event_id, status, current_step, input, output, state, error, started_at, completed_at, created_at, updated_at)
             select $17, $15, $16, inserted_event.id, $18, $19, $20, $21, $22, $23, $24, $25, now(), now()
             from inserted_event
             join inserted_match on inserted_match.ingest_event_id = inserted_event.id
             returning *
           ),
           inserted_timeline as (
             insert into ${this.#schema}."WorkflowTimelineEvent"
               (id, run_id, sequence, type, node_id, payload, created_at)
             select
               $26,
               inserted_run.id,
               1,
               'INGEST_MATCHED',
               null,
               jsonb_build_object('eventId', inserted_event.id, 'source', $2::text, 'eventType', $5::text),
               now()
             from inserted_run
             join inserted_event on true
             returning id
           )
	           select row_to_json(inserted_event) as event,
	                  row_to_json(inserted_run) as run,
	                  inserted_event.inserted as inserted
	           from inserted_event
	           left join inserted_run on true`,
          [
            id('evt'),
            input.event.source,
            input.event.connectorAccountId ?? null,
            input.event.externalId,
            input.event.eventType,
            input.event.dedupeKey,
            input.event.occurredAt ?? null,
            input.event.headers ?? null,
            input.event.rawPayload,
            input.event.normalizedPayload ?? null,
            input.event.signatureVerified,
            input.event.status,
            input.event.error ?? null,
            id('match'),
            run.workflowId,
            run.versionId,
            id('run'),
            run.status,
            run.currentNode ?? null,
            run.input,
            run.output ?? null,
            run.state,
            run.error ?? null,
            run.startedAt ?? null,
            run.completedAt ?? null,
            id('tl'),
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error('Expected ingest event result row.');
        const runRecord = recordJson(row, 'run');
        return {
          event: ingestEventFromRow(recordJson(row, 'event')),
          runs: Object.keys(runRecord).length > 0 ? [runFromRow(runRecord)] : [],
          duplicate: row['inserted'] !== true,
          timelinesCreated: Object.keys(runRecord).length > 0,
        };
      }
      await client.query('begin');
      try {
        const eventResult = await client.query(
          `${insertIngestEvent(this.#schema)}
           on conflict (dedupe_key) do nothing
           returning *`,
          [
            id('evt'),
            input.event.source,
            input.event.connectorAccountId ?? null,
            input.event.externalId,
            input.event.eventType,
            input.event.dedupeKey,
            input.event.occurredAt ?? null,
            input.event.headers ?? null,
            input.event.rawPayload,
            input.event.normalizedPayload ?? null,
            input.event.signatureVerified,
            input.event.status,
            input.event.error ?? null,
          ],
        );
        const insertedEventRow = eventResult.rows[0];
        if (!insertedEventRow) {
          const existingEvent = await client.query(
            `${selectIngestEvents(this.#schema)} where dedupe_key = $1`,
            [input.event.dedupeKey],
          );
          await client.query('commit');
          return {
            event: ingestEventFromRow(
              requireRow(
                existingEvent.rows[0],
                `Workflow ingest event not found for dedupe key: ${input.event.dedupeKey}`,
              ),
            ),
            runs: [],
            duplicate: true,
          };
        }

        const event = ingestEventFromRow(insertedEventRow);
        const runs: WorkflowRunRecord[] = [];
        for (const run of input.runs) {
          const matchResult = await client.query(
            `insert into ${this.#schema}."WorkflowTriggerMatch"
               (id, ingest_event_id, workflow_id, version_id, created_at)
             values ($1, $2, $3, $4, now())
             on conflict (ingest_event_id, workflow_id, version_id) do nothing
             returning *`,
            [id('match'), event.id, run.workflowId, run.versionId],
          );
          if (!matchResult.rows[0]) {
            continue;
          }
          const runResult = await client.query(
            `insert into ${this.#schema}."WorkflowRun"
               (id, workflow_id, version_id, ingest_event_id, status, current_step, input, output, state, error, started_at, completed_at, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
             returning *`,
            [
              id('run'),
              run.workflowId,
              run.versionId,
              event.id,
              run.status,
              run.currentNode ?? null,
              run.input,
              run.output ?? null,
              run.state,
              run.error ?? null,
              run.startedAt ?? null,
              run.completedAt ?? null,
            ],
          );
          runs.push(runFromRow(requireRow(runResult.rows[0])));
        }
        await client.query('commit');
        return { event, runs, duplicate: false };
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });
  }

  async findIngestEventByDedupeKey(
    dedupeKey: string,
  ): Promise<WorkflowIngestEventRecord | undefined> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `${selectIngestEvents(this.#schema)} where dedupe_key = $1`,
        [dedupeKey],
      );
      return result.rows[0] ? ingestEventFromRow(result.rows[0]) : undefined;
    });
  }

  async createRun(run: Omit<WorkflowRunRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowRun"
           (id, workflow_id, version_id, ingest_event_id, status, current_step, input, output, state, error, started_at, completed_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
         returning *`,
        [
          id('run'),
          run.workflowId,
          run.versionId,
          run.ingestEventId ?? null,
          run.status,
          run.currentNode ?? null,
          run.input,
          run.output ?? null,
          run.state,
          run.error ?? null,
          run.startedAt ?? null,
          run.completedAt ?? null,
        ],
      );
      return runFromRow(requireRow(result.rows[0]));
    });
  }

  async createRunWithTimeline(input: CreateRunWithTimelineInput): Promise<WorkflowRunRecord> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with inserted_run as (
           insert into ${this.#schema}."WorkflowRun"
             (id, workflow_id, version_id, ingest_event_id, status, current_step, input, output, state, error, started_at, completed_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
           returning *
         ),
         inserted_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select $13, inserted_run.id, 1, $14, $15, $16, now()
           from inserted_run
           returning id
         )
         select inserted_run.*
         from inserted_run
         where exists (select 1 from inserted_timeline)`,
        [
          id('run'),
          input.run.workflowId,
          input.run.versionId,
          input.run.ingestEventId ?? null,
          input.run.status,
          input.run.currentNode ?? null,
          input.run.input,
          input.run.output ?? null,
          input.run.state,
          input.run.error ?? null,
          input.run.startedAt ?? null,
          input.run.completedAt ?? null,
          id('tl'),
          input.event.type,
          input.event.nodeId ?? null,
          input.event.payload ?? null,
        ],
      );
      return runFromRow(requireRow(result.rows[0]));
    });
  }

  async createRunWithTimelineAndSnapshot(
    input: CreateRunWithTimelineAndSnapshotInput,
  ): Promise<WorkflowRunRecord> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with inserted_run as (
           insert into ${this.#schema}."WorkflowRun"
             (id, workflow_id, version_id, ingest_event_id, status, current_step, input, output, state, error, started_at, completed_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
           returning *
         ),
         inserted_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select $13, inserted_run.id, 1, $14, $15, $16, now()
           from inserted_run
           returning id
         ),
         inserted_snapshot as (
           insert into ${this.#schema}."WorkflowStateSnapshot"
             (id, run_id, sequence, node_id, state, diff, created_at)
           select $17, inserted_run.id, 1, $18, $19, $20, now()
           from inserted_run
           where exists (select 1 from inserted_timeline)
           returning id
         )
         select inserted_run.*
         from inserted_run
         where exists (select 1 from inserted_snapshot)`,
        [
          id('run'),
          input.run.workflowId,
          input.run.versionId,
          input.run.ingestEventId ?? null,
          input.run.status,
          input.run.currentNode ?? null,
          input.run.input,
          input.run.output ?? null,
          input.run.state,
          input.run.error ?? null,
          input.run.startedAt ?? null,
          input.run.completedAt ?? null,
          id('tl'),
          input.event.type,
          input.event.nodeId ?? null,
          input.event.payload ?? null,
          id('snap'),
          input.snapshot.nodeId ?? null,
          input.snapshot.state,
          input.snapshot.diff ?? null,
        ],
      );
      return runFromRow(requireRow(result.rows[0]));
    });
  }

  async updateRun(idValue: string, patch: Partial<WorkflowRunRecord>): Promise<WorkflowRunRecord> {
    const values: unknown[] = [];
    const sets: string[] = [];
    addSet(sets, values, 'status', patch.status);
    if ('currentNode' in patch) {
      addNullableSet(sets, values, 'current_step', patch.currentNode);
    }
    addSet(sets, values, 'input', patch.input);
    addSet(sets, values, 'output', patch.output);
    addSet(sets, values, 'state', patch.state);
    addSet(sets, values, 'error', patch.error);
    addSet(sets, values, 'started_at', patch.startedAt);
    addSet(sets, values, 'completed_at', patch.completedAt);
    sets.push('updated_at = now()');
    values.push(idValue);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowRun" set ${sets.join(', ')} where id = $${values.length} returning *`,
        values,
      );
      return runFromRow(requireRow(result.rows[0], `Workflow run not found: ${idValue}`));
    });
  }

  async updateRunIfLeased(input: LeasedRunUpdateInput): Promise<WorkflowRunRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.runId)) return undefined;
    const values: unknown[] = [];
    const sets: string[] = [];
    addSet(sets, values, 'status', input.patch.status);
    if ('currentNode' in input.patch) {
      addNullableSet(sets, values, 'current_step', input.patch.currentNode);
    }
    addSet(sets, values, 'input', input.patch.input);
    addSet(sets, values, 'output', input.patch.output);
    addSet(sets, values, 'state', input.patch.state);
    addSet(sets, values, 'error', input.patch.error);
    addSet(sets, values, 'started_at', input.patch.startedAt);
    addSet(sets, values, 'completed_at', input.patch.completedAt);
    sets.push('updated_at = now()');
    values.push(input.runId);
    const idParam = values.length;
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowRun"
         set ${sets.join(', ')}
         where id = $${idParam} and ${guard}
         returning *`,
        values,
      );
      return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
    });
  }

  async appendTimelineAndUpdateRunIfLeased(
    input: LeasedTimelineRunUpdateInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.runId)) return undefined;
    const values: unknown[] = [
      id('tl'),
      input.runId,
      input.event.type,
      input.event.nodeId ?? null,
      input.event.payload ?? null,
    ];
    const sets: string[] = [];
    addSet(sets, values, 'status', input.patch.status);
    if ('currentNode' in input.patch) {
      addNullableSet(sets, values, 'current_step', input.patch.currentNode);
    }
    addSet(sets, values, 'input', input.patch.input);
    addSet(sets, values, 'output', input.patch.output);
    addSet(sets, values, 'state', input.patch.state);
    addSet(sets, values, 'error', input.patch.error);
    addSet(sets, values, 'started_at', input.patch.startedAt);
    addSet(sets, values, 'completed_at', input.patch.completedAt);
    sets.push('updated_at = now()');
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    let releaseLeaseCte = '';
    if (input.releaseRunLease) {
      values.push(input.guard.leaseId);
      const leaseIdParam = values.length;
      values.push(input.guard.resourceType);
      const resourceTypeParam = values.length;
      values.push(input.guard.resourceId);
      const resourceIdParam = values.length;
      values.push(input.guard.workerId);
      const workerIdParam = values.length;
      releaseLeaseCte = `,
         released_lease as (
           delete from ${this.#schema}."WorkflowLease"
           where id = $${leaseIdParam}
             and resource_type = $${resourceTypeParam}
             and resource_id = $${resourceIdParam}
             and worker_id = $${workerIdParam}
             and exists (select 1 from updated_run)
           returning id
         )`;
    }
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with inserted_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             $1,
             $2,
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $2), 1),
             $3,
             $4,
             $5,
             now()
           where ${guard}
           returning id
         ),
         updated_run as (
           update ${this.#schema}."WorkflowRun"
           set ${sets.join(', ')}
           where id = $2 and exists (select 1 from inserted_timeline)
           returning *
         )${releaseLeaseCte}
         select * from updated_run`,
        values,
      );
      return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
    });
  }

  async supersedeReplayWaitsIfLeased(input: LeasedReplayWaitSupersedeInput): Promise<void> {
    if (!isRunLeaseGuard(input.guard, input.runId)) return;
    const approvalValues: unknown[] = [
      input.runId,
      input.supersededAt ?? new Date(),
      'system:workflow-replay',
      'Superseded by replay',
    ];
    const approvalGuard = activeLeasePredicate(this.#schema, approvalValues, input.guard);
    const timerValues: unknown[] = [input.runId];
    const timerGuard = activeLeasePredicate(this.#schema, timerValues, input.guard);
    await this.#withClient(async (client) => {
      await client.query(
        `update ${this.#schema}."WorkflowApproval"
         set status = 'expired',
             resolved_at = $2,
             resolved_by = $3,
             reason = $4
         where run_id = $1
           and status = 'pending'
           and ${approvalGuard}`,
        approvalValues,
      );
      await client.query(
        `update ${this.#schema}."WorkflowTimer"
         set status = 'cancelled'
         where run_id = $1
           and status in ('scheduled', 'completed')
           and ${timerGuard}`,
        timerValues,
      );
    });
  }

  async findRun(idValue: string): Promise<WorkflowRunRecord | undefined> {
    return this.#withClient(async (client) => {
      const result = await client.query(`${selectRuns(this.#schema)} where id = $1`, [idValue]);
      return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
    });
  }

  async nextQueuedRun(): Promise<WorkflowRunRecord | undefined> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `${selectRuns(this.#schema)} where status = 'queued' order by created_at limit 1`,
      );
      return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
    });
  }

  async claimNextRun(input: ClaimNextRunInput): Promise<WorkflowRunRecord | undefined> {
    return (await this.claimNextRunWithLease(input))?.run;
  }

  async claimNextRunWithLease(input: ClaimNextRunInput): Promise<WorkflowRunClaim | undefined> {
    const now = input.now ?? new Date();
    const lockedUntil = new Date(now.valueOf() + input.ttlMs);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with candidate as (
             select r.*
             from ${this.#schema}."WorkflowRun" r
             left join ${this.#schema}."WorkflowLease" l
               on l.resource_type = 'run' and l.resource_id = r.id
             where r.status in ('queued', 'running')
               and (l.id is null or l.locked_until <= $1)
             order by case when r.status = 'queued' then 0 else 1 end, r.created_at
             for update of r skip locked
             limit 1
           ),
           claimed as (
             insert into ${this.#schema}."WorkflowLease"
               (id, resource_type, resource_id, worker_id, locked_until, heartbeat_at)
             select $3, 'run', candidate.id, $2, $4, $1
             from candidate
             on conflict (resource_type, resource_id) do update
               set id = excluded.id,
                   worker_id = excluded.worker_id,
                   locked_until = excluded.locked_until,
                   heartbeat_at = excluded.heartbeat_at
             where ${this.#schema}."WorkflowLease".locked_until <= excluded.heartbeat_at
             returning *
           )
           select candidate.*,
                  claimed.id as lease_id,
                  claimed.resource_type as lease_resource_type,
                  claimed.resource_id as lease_resource_id,
                  claimed.worker_id as lease_worker_id,
                  claimed.locked_until as lease_locked_until,
                  claimed.heartbeat_at as lease_heartbeat_at
           from candidate
           join claimed on claimed.resource_id = candidate.id`,
        [now, input.workerId, id('lease'), lockedUntil],
      );
      return result.rows[0]
        ? { run: runFromRow(result.rows[0]), lease: leaseFromClaimRow(result.rows[0]) }
        : undefined;
    });
  }

  async claimRun(input: ClaimRunInput): Promise<WorkflowRunRecord | undefined> {
    return (await this.claimRunWithLease(input))?.run;
  }

  async claimRunWithLease(input: ClaimRunInput): Promise<WorkflowRunClaim | undefined> {
    const now = input.now ?? new Date();
    const lockedUntil = new Date(now.valueOf() + input.ttlMs);
    const statuses = input.statuses ?? CLAIMABLE_RUN_STATUSES;
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with candidate as (
             select r.*
             from ${this.#schema}."WorkflowRun" r
             left join ${this.#schema}."WorkflowLease" l
               on l.resource_type = 'run' and l.resource_id = r.id
             where r.id = $5
               and r.status = any($6::text[])
               and (l.id is null or l.locked_until <= $1)
             for update of r skip locked
           ),
           claimed as (
             insert into ${this.#schema}."WorkflowLease"
               (id, resource_type, resource_id, worker_id, locked_until, heartbeat_at)
             select $3, 'run', candidate.id, $2, $4, $1
             from candidate
             on conflict (resource_type, resource_id) do update
               set id = excluded.id,
                   worker_id = excluded.worker_id,
                   locked_until = excluded.locked_until,
                   heartbeat_at = excluded.heartbeat_at
             where ${this.#schema}."WorkflowLease".locked_until <= excluded.heartbeat_at
             returning *
           )
           select candidate.*,
                  claimed.id as lease_id,
                  claimed.resource_type as lease_resource_type,
                  claimed.resource_id as lease_resource_id,
                  claimed.worker_id as lease_worker_id,
                  claimed.locked_until as lease_locked_until,
                  claimed.heartbeat_at as lease_heartbeat_at
           from candidate
           join claimed on claimed.resource_id = candidate.id`,
        [now, input.workerId, id('lease'), lockedUntil, input.runId, statuses],
      );
      return result.rows[0]
        ? { run: runFromRow(result.rows[0]), lease: leaseFromClaimRow(result.rows[0]) }
        : undefined;
    });
  }

  async claimApprovalRunWithLease(
    input: ClaimApprovalRunInput,
  ): Promise<WorkflowApprovalRunClaim | undefined> {
    const now = input.now ?? new Date();
    const lockedUntil = new Date(now.valueOf() + input.ttlMs);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with candidate as (
             select r.*,
                    row_to_json(approval) as approval
             from ${this.#schema}."WorkflowApproval" approval
             join ${this.#schema}."WorkflowRun" r on r.id = approval.run_id
             left join ${this.#schema}."WorkflowLease" l
               on l.resource_type = 'run' and l.resource_id = r.id
             where approval.id = $5
               and approval.status = 'pending'
               and r.status = 'waiting_for_approval'
               and r.current_step = approval.node_id
               and (l.id is null or l.locked_until <= $1)
             for update of r skip locked
           ),
           claimed as (
             insert into ${this.#schema}."WorkflowLease"
               (id, resource_type, resource_id, worker_id, locked_until, heartbeat_at)
             select $3, 'run', candidate.id, $2, $4, $1
             from candidate
             on conflict (resource_type, resource_id) do update
               set id = excluded.id,
                   worker_id = excluded.worker_id,
                   locked_until = excluded.locked_until,
                   heartbeat_at = excluded.heartbeat_at
             where ${this.#schema}."WorkflowLease".locked_until <= excluded.heartbeat_at
             returning *
           )
           select candidate.*,
                  claimed.id as lease_id,
                  claimed.resource_type as lease_resource_type,
                  claimed.resource_id as lease_resource_id,
                  claimed.worker_id as lease_worker_id,
                  claimed.locked_until as lease_locked_until,
                  claimed.heartbeat_at as lease_heartbeat_at
           from candidate
           join claimed on claimed.resource_id = candidate.id`,
        [now, input.workerId, id('lease'), lockedUntil, input.approvalId],
      );
      const row = result.rows[0];
      return row
        ? {
            approval: approvalFromRow(recordJson(row, 'approval')),
            run: runFromRow(row),
            lease: leaseFromClaimRow(row),
          }
        : undefined;
    });
  }

  async findLease(
    resourceType: WorkflowLeaseRecord['resourceType'],
    resourceId: string,
    workerId?: string,
  ): Promise<WorkflowLeaseRecord | undefined> {
    const values: unknown[] = [resourceType, resourceId];
    const workerFilter = workerId === undefined ? '' : ` and worker_id = $${values.push(workerId)}`;
    return this.#withClient(async (client) => {
      const result = await client.query(
        `${selectLeases(this.#schema)} where resource_type = $1 and resource_id = $2${workerFilter}`,
        values,
      );
      return result.rows[0] ? leaseFromRow(result.rows[0]) : undefined;
    });
  }

  async inspectRun(input: InspectWorkflowRunInput): Promise<WorkflowRunInspection | undefined> {
    return this.#withClient(async (client) => {
      const runResult = await client.query(`${selectRuns(this.#schema)} where id = $1`, [
        input.runId,
      ]);
      const row = runResult.rows[0];
      if (!row) return undefined;
      const include = input.include ?? {};
      return {
        run: runFromRow(row),
        ...(include.steps === true
          ? {
              steps: (
                await client.query(
                  `${selectStepRuns(this.#schema)} where run_id = $1 order by created_at`,
                  [input.runId],
                )
              ).rows.map(stepRunFromRow),
            }
          : {}),
        ...(include.timeline === true
          ? {
              timeline: (
                await client.query(
                  `${selectTimeline(this.#schema)} where run_id = $1 order by sequence`,
                  [input.runId],
                )
              ).rows.map(timelineFromRow),
            }
          : {}),
        ...(include.stateSnapshots === true
          ? {
              stateSnapshots: (
                await client.query(
                  `${selectStateSnapshots(this.#schema)} where run_id = $1 order by sequence`,
                  [input.runId],
                )
              ).rows.map(stateSnapshotFromRow),
            }
          : {}),
        ...(include.approvals === true
          ? {
              approvals: (
                await client.query(
                  `${selectApprovals(this.#schema)} where run_id = $1 order by requested_at`,
                  [input.runId],
                )
              ).rows.map(approvalFromRow),
            }
          : {}),
        ...(include.outbox === true
          ? {
              outbox: (
                await client.query(
                  `${selectOutbox(this.#schema)} where run_id = $1 order by created_at`,
                  [input.runId],
                )
              ).rows.map(outboxFromRow),
            }
          : {}),
        ...(include.deadLetters === true
          ? {
              deadLetters: (
                await client.query(
                  `${selectDeadLetters(this.#schema)} where resource_id = $1 order by created_at`,
                  [input.runId],
                )
              ).rows.map(deadLetterFromRow),
            }
          : {}),
      };
    });
  }

  async createStepRun(step: Omit<WorkflowStepRunRecord, 'id' | 'createdAt'>) {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowStepRun"
           (id, run_id, node_id, step_name, attempt, status, input, output, error, started_at, completed_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         returning *`,
        [
          id('step'),
          step.runId,
          step.nodeId,
          step.stepName,
          step.attempt,
          step.status,
          step.input ?? null,
          step.output ?? null,
          step.error ?? null,
          step.startedAt ?? null,
          step.completedAt ?? null,
        ],
      );
      return stepRunFromRow(requireRow(result.rows[0]));
    });
  }

  async findStepRun(idValue: string): Promise<WorkflowStepRunRecord | undefined> {
    return this.#withClient(async (client) => {
      const result = await client.query(`${selectStepRuns(this.#schema)} where id = $1`, [idValue]);
      return result.rows[0] ? stepRunFromRow(result.rows[0]) : undefined;
    });
  }

  async createStepRunIfLeased(
    input: LeasedStepRunCreateInput,
  ): Promise<WorkflowStepRunRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.step.runId)) return undefined;
    const values: unknown[] = [
      id('step'),
      input.step.runId,
      input.step.nodeId,
      input.step.stepName,
      input.step.attempt,
      input.step.status,
      input.step.input ?? null,
      input.step.output ?? null,
      input.step.error ?? null,
      input.step.startedAt ?? null,
      input.step.completedAt ?? null,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowStepRun"
           (id, run_id, node_id, step_name, attempt, status, input, output, error, started_at, completed_at, created_at)
         select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()
         where ${guard}
         returning *`,
        values,
      );
      return result.rows[0] ? stepRunFromRow(result.rows[0]) : undefined;
    });
  }

  async createStepRunAndAppendStartedTimelineIfLeased(
    input: LeasedStepRunStartInput,
  ): Promise<WorkflowStepRunRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.step.runId)) return undefined;
    const values: unknown[] = [
      id('step'),
      input.step.runId,
      input.step.nodeId,
      input.step.stepName,
      input.step.attempt,
      input.step.status,
      input.step.input ?? null,
      input.step.output ?? null,
      input.step.error ?? null,
      input.step.startedAt ?? null,
      input.step.completedAt ?? null,
      id('tl'),
      input.event.type,
      input.event.nodeId ?? null,
      input.event.payload ?? null,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with inserted_step as (
           insert into ${this.#schema}."WorkflowStepRun"
             (id, run_id, node_id, step_name, attempt, status, input, output, error, started_at, completed_at, created_at)
           select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()
           where ${guard}
           returning *
         ),
         inserted_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             $12,
             $2,
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $2), 1),
             $13,
             $14,
             $15,
             now()
           where exists (select 1 from inserted_step)
           returning id
         )
         select inserted_step.*
         from inserted_step
         where exists (select 1 from inserted_timeline)`,
        values,
      );
      return result.rows[0] ? stepRunFromRow(result.rows[0]) : undefined;
    });
  }

  async createCompletedStepAndAdvanceIfLeased(
    input: LeasedCompletedStepCreateInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.step.runId)) return undefined;
    const values: unknown[] = [
      id('step'),
      input.step.runId,
      input.step.nodeId,
      input.step.stepName,
      input.step.attempt,
      input.step.input,
      input.step.output ?? null,
      input.step.startedAt,
      input.step.completedAt,
      id('tl'),
      input.startedEvent.type,
      input.startedEvent.nodeId ?? null,
      input.startedEvent.payload ?? null,
      id('tl'),
      input.completedEvent.type,
      input.completedEvent.nodeId ?? null,
      input.completedEvent.payload ?? null,
      id('snap'),
      input.snapshot.nodeId ?? null,
      input.snapshot.state,
      input.snapshot.diff ?? null,
      input.runPatch.state,
      input.runPatch.currentNode ?? null,
      input.runPatch.status,
      input.runPatch.error ?? null,
      input.runPatch.startedAt ?? null,
      input.runPatch.output ?? null,
      input.runPatch.completedAt ?? null,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    let terminalTimelineCte = '';
    let terminalSnapshotGuard = '';
    if (input.terminalEvent) {
      values.push(id('tl'));
      const terminalIdParam = values.length;
      values.push(input.terminalEvent.type);
      const terminalTypeParam = values.length;
      values.push(input.terminalEvent.nodeId ?? null);
      const terminalNodeParam = values.length;
      values.push(input.terminalEvent.payload ?? null);
      const terminalPayloadParam = values.length;
      terminalTimelineCte = `,
         inserted_terminal_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             $${terminalIdParam},
             $2,
             inserted_completed_timeline.sequence + 1,
             $${terminalTypeParam},
             $${terminalNodeParam},
             $${terminalPayloadParam},
             now()
           from inserted_completed_timeline
           returning id
         )`;
      terminalSnapshotGuard = ' and exists (select 1 from inserted_terminal_timeline)';
    }
    let releaseRunLeaseCte = '';
    if (input.releaseRunLease) {
      values.push(input.guard.leaseId);
      const leaseIdParam = values.length;
      values.push(input.guard.resourceType);
      const resourceTypeParam = values.length;
      values.push(input.guard.resourceId);
      const resourceIdParam = values.length;
      values.push(input.guard.workerId);
      const workerIdParam = values.length;
      releaseRunLeaseCte = `,
         released_run_lease as (
           delete from ${this.#schema}."WorkflowLease"
           where id = $${leaseIdParam}
             and resource_type = $${resourceTypeParam}
             and resource_id = $${resourceIdParam}
             and worker_id = $${workerIdParam}
             and exists (select 1 from updated_run)
           returning id
         )`;
    }
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with inserted_step as (
           insert into ${this.#schema}."WorkflowStepRun"
             (id, run_id, node_id, step_name, attempt, status, input, output, error, started_at, completed_at, created_at)
           select $1, $2, $3, $4, $5, 'completed', $6, $7, null, $8, $9, now()
           where ${guard}
           returning id
         ),
         inserted_started_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             $10,
             $2,
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $2), 1),
             $11,
             $12,
             $13,
             now()
           where exists (select 1 from inserted_step)
           returning sequence
         ),
         inserted_completed_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             $14,
             $2,
             inserted_started_timeline.sequence + 1,
             $15,
             $16,
             $17,
             now()
           from inserted_started_timeline
           returning sequence
         )${terminalTimelineCte},
         inserted_snapshot as (
           insert into ${this.#schema}."WorkflowStateSnapshot"
             (id, run_id, sequence, node_id, state, diff, created_at)
           select
             $18,
             $2,
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowStateSnapshot" where run_id = $2), 1),
             $19,
             $20,
             $21,
             now()
           where exists (select 1 from inserted_completed_timeline)
             ${terminalSnapshotGuard}
           returning id
         ),
         updated_run as (
           update ${this.#schema}."WorkflowRun"
           set state = $22,
               current_step = $23,
               status = $24,
               error = $25,
               started_at = coalesce(started_at, $26),
               output = coalesce($27::jsonb, output),
               completed_at = coalesce($28, completed_at),
               updated_at = now()
           where id = $2 and exists (select 1 from inserted_snapshot)
           returning *
         )${releaseRunLeaseCte}
         select * from updated_run`,
        values,
      );
      return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
    });
  }

  async updateStepRun(
    idValue: string,
    patch: Partial<WorkflowStepRunRecord>,
  ): Promise<WorkflowStepRunRecord> {
    const values: unknown[] = [];
    const sets: string[] = [];
    addSet(sets, values, 'status', patch.status);
    addSet(sets, values, 'input', patch.input);
    addSet(sets, values, 'output', patch.output);
    addSet(sets, values, 'error', patch.error);
    addSet(sets, values, 'started_at', patch.startedAt);
    addSet(sets, values, 'completed_at', patch.completedAt);
    values.push(idValue);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowStepRun" set ${sets.join(', ')} where id = $${values.length} returning *`,
        values,
      );
      return stepRunFromRow(requireRow(result.rows[0], `Workflow step run not found: ${idValue}`));
    });
  }

  async updateStepRunIfLeased(
    input: LeasedStepRunUpdateInput,
  ): Promise<WorkflowStepRunRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.runId)) return undefined;
    const values: unknown[] = [];
    const sets: string[] = [];
    addSet(sets, values, 'status', input.patch.status);
    addSet(sets, values, 'input', input.patch.input);
    addSet(sets, values, 'output', input.patch.output);
    addSet(sets, values, 'error', input.patch.error);
    addSet(sets, values, 'started_at', input.patch.startedAt);
    addSet(sets, values, 'completed_at', input.patch.completedAt);
    values.push(input.stepRunId);
    const stepRunIdParam = values.length;
    values.push(input.runId);
    const runIdParam = values.length;
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowStepRun"
         set ${sets.join(', ')}
         where id = $${stepRunIdParam} and run_id = $${runIdParam} and ${guard}
         returning *`,
        values,
      );
      return result.rows[0] ? stepRunFromRow(result.rows[0]) : undefined;
    });
  }

  async completeStepAndAdvanceIfLeased(
    input: LeasedStepCompletionInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.runId)) return undefined;
    const values: unknown[] = [
      input.stepRunId,
      input.runId,
      input.stepOutput ?? null,
      input.completedAt,
      id('tl'),
      input.event.type,
      input.event.nodeId ?? null,
      input.event.payload ?? null,
      id('snap'),
      input.snapshot.nodeId ?? null,
      input.snapshot.state,
      input.snapshot.diff ?? null,
      input.runPatch.state,
      input.runPatch.currentNode ?? null,
      input.runPatch.status,
      input.runPatch.error ?? null,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with updated_step as (
           update ${this.#schema}."WorkflowStepRun"
           set status = 'completed',
               output = $3,
               completed_at = $4
           where id = $1 and run_id = $2 and ${guard}
           returning id
         ),
         inserted_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             $5,
             $2,
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $2), 1),
             $6,
             $7,
             $8,
             now()
           where exists (select 1 from updated_step)
           returning id
         ),
         inserted_snapshot as (
           insert into ${this.#schema}."WorkflowStateSnapshot"
             (id, run_id, sequence, node_id, state, diff, created_at)
           select
             $9,
             $2,
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowStateSnapshot" where run_id = $2), 1),
             $10,
             $11,
             $12,
             now()
           where exists (select 1 from inserted_timeline)
           returning id
         )
         update ${this.#schema}."WorkflowRun"
         set state = $13,
             current_step = $14,
             status = $15,
             error = $16,
             updated_at = now()
         where id = $2 and exists (select 1 from inserted_snapshot)
         returning *`,
        values,
      );
      return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
    });
  }

  async failStepAndScheduleRetryIfLeased(
    input: LeasedStepRetryScheduleInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.runId)) return undefined;
    const values: unknown[] = [
      input.stepRunId,
      input.runId,
      input.message,
      input.completedAt,
      id('tl'),
      input.event.type,
      input.event.nodeId ?? null,
      input.event.payload ?? null,
      input.runPatch.status,
      input.runPatch.currentNode ?? null,
      input.runPatch.error ?? null,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with updated_step as (
           update ${this.#schema}."WorkflowStepRun"
           set status = 'failed',
               error = jsonb_build_object('message', $3::text),
               completed_at = $4
           where id = $1 and run_id = $2 and ${guard}
           returning id
         ),
         inserted_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             $5,
             $2,
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $2), 1),
             $6,
             $7,
             $8,
             now()
           where exists (select 1 from updated_step)
           returning id
         )
         update ${this.#schema}."WorkflowRun"
         set status = $9,
             current_step = $10,
             error = $11,
             updated_at = now()
         where id = $2 and exists (select 1 from inserted_timeline)
         returning *`,
        values,
      );
      return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
    });
  }

  async appendTimeline(event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>) {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowTimelineEvent"
           (id, run_id, sequence, type, node_id, payload, created_at)
         values (
           $1,
           $2,
           coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $2), 1),
           $3,
           $4,
           $5,
           now()
         )
         returning *`,
        [id('tl'), event.runId, event.type, event.nodeId ?? null, event.payload ?? null],
      );
      return timelineFromRow(requireRow(result.rows[0]));
    });
  }

  async appendTimelineBatch(
    events: readonly Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>[],
  ): Promise<readonly WorkflowTimelineEventRecord[]> {
    if (events.length === 0) return [];
    const values: unknown[] = [];
    const rows = events.map((event) => {
      const idParam = values.push(id('tl'));
      const runIdParam = values.push(event.runId);
      const typeParam = values.push(event.type);
      const nodeIdParam = values.push(event.nodeId ?? null);
      const payloadParam = values.push(event.payload ?? null);
      return `(
        $${idParam},
        $${runIdParam},
        coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $${runIdParam}), 1),
        $${typeParam},
        $${nodeIdParam},
        $${payloadParam},
        now()
      )`;
    });
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowTimelineEvent"
           (id, run_id, sequence, type, node_id, payload, created_at)
         values ${rows.join(', ')}
         returning *`,
        values,
      );
      return result.rows.map((row) => timelineFromRow(row));
    });
  }

  async appendTimelineIfLeased(
    input: LeasedTimelineAppendInput,
  ): Promise<WorkflowTimelineEventRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.event.runId)) return undefined;
    const values: unknown[] = [
      id('tl'),
      input.event.runId,
      input.event.type,
      input.event.nodeId ?? null,
      input.event.payload ?? null,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowTimelineEvent"
           (id, run_id, sequence, type, node_id, payload, created_at)
         select
           $1,
           $2,
           coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $2), 1),
           $3,
           $4,
           $5,
           now()
         where ${guard}
         returning *`,
        values,
      );
      return result.rows[0] ? timelineFromRow(result.rows[0]) : undefined;
    });
  }

  async appendSnapshot(
    snapshot: Omit<WorkflowStateSnapshotRecord, 'id' | 'sequence' | 'createdAt'>,
  ) {
    return this.#withClient(async (client) => {
      const previous = await latestSnapshotState(client, this.#schema, snapshot.runId);
      const diff = snapshot.diff ?? shallowDiff(previous, snapshot.state);
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowStateSnapshot"
           (id, run_id, sequence, node_id, state, diff, created_at)
         values (
           $1,
           $2,
           coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowStateSnapshot" where run_id = $2), 1),
           $3,
           $4,
           $5,
           now()
         )
         returning *`,
        [id('snap'), snapshot.runId, snapshot.nodeId ?? null, snapshot.state, diff],
      );
      return stateSnapshotFromRow(requireRow(result.rows[0]));
    });
  }

  async appendSnapshotIfLeased(
    input: LeasedSnapshotAppendInput,
  ): Promise<WorkflowStateSnapshotRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.snapshot.runId)) return undefined;
    return this.#withClient(async (client) => {
      const previous = await latestSnapshotState(client, this.#schema, input.snapshot.runId);
      const diff = input.snapshot.diff ?? shallowDiff(previous, input.snapshot.state);
      const values: unknown[] = [
        id('snap'),
        input.snapshot.runId,
        input.snapshot.nodeId ?? null,
        input.snapshot.state,
        diff,
      ];
      const guard = activeLeasePredicate(this.#schema, values, input.guard);
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowStateSnapshot"
           (id, run_id, sequence, node_id, state, diff, created_at)
         select
           $1,
           $2,
           coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowStateSnapshot" where run_id = $2), 1),
           $3,
           $4,
           $5,
           now()
         where ${guard}
         returning *`,
        values,
      );
      return result.rows[0] ? stateSnapshotFromRow(result.rows[0]) : undefined;
    });
  }

  async createApproval(approval: Omit<WorkflowApprovalRecord, 'id' | 'requestedAt'>) {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowApproval"
           (id, run_id, node_id, approval_name, status, requested_at, resolved_at, resolved_by, decision, reason, assignees, expires_at, payload)
         values ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9, $10, $11, $12)
         returning *`,
        [
          id('approval'),
          approval.runId,
          approval.nodeId,
          approval.approvalName,
          approval.status,
          approval.resolvedAt ?? null,
          approval.resolvedBy ?? null,
          approval.decision ?? null,
          approval.reason ?? null,
          JSON.stringify(approval.assignees),
          approval.expiresAt ?? null,
          approval.payload ?? null,
        ],
      );
      return approvalFromRow(requireRow(result.rows[0]));
    });
  }

  async createApprovalIfLeased(
    input: LeasedApprovalCreateInput,
  ): Promise<WorkflowApprovalRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.approval.runId)) return undefined;
    const values: unknown[] = [
      id('approval'),
      input.approval.runId,
      input.approval.nodeId,
      input.approval.approvalName,
      input.approval.status,
      input.approval.resolvedAt ?? null,
      input.approval.resolvedBy ?? null,
      input.approval.decision ?? null,
      input.approval.reason ?? null,
      JSON.stringify(input.approval.assignees),
      input.approval.expiresAt ?? null,
      input.approval.payload ?? null,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowApproval"
           (id, run_id, node_id, approval_name, status, requested_at, resolved_at, resolved_by, decision, reason, assignees, expires_at, payload)
         select $1, $2, $3, $4, $5, now(), $6, $7, $8, $9, $10, $11, $12
         where ${guard}
         returning *`,
        values,
      );
      return result.rows[0] ? approvalFromRow(result.rows[0]) : undefined;
    });
  }

  async createApprovalAndWaitIfLeased(
    input: LeasedApprovalWaitInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.approval.runId)) return undefined;
    const values: unknown[] = [
      id('approval'),
      input.approval.runId,
      input.approval.nodeId,
      input.approval.approvalName,
      input.approval.status,
      input.approval.resolvedAt ?? null,
      input.approval.resolvedBy ?? null,
      input.approval.decision ?? null,
      input.approval.reason ?? null,
      JSON.stringify(input.approval.assignees),
      input.approval.expiresAt ?? null,
      input.approval.payload ?? null,
      id('tl'),
      input.event.type,
      input.event.nodeId ?? null,
      input.event.payload ?? null,
    ];
    const sets: string[] = [];
    addSet(sets, values, 'status', input.runPatch.status);
    if ('currentNode' in input.runPatch) {
      addNullableSet(sets, values, 'current_step', input.runPatch.currentNode);
    }
    addSet(sets, values, 'input', input.runPatch.input);
    addSet(sets, values, 'output', input.runPatch.output);
    addSet(sets, values, 'state', input.runPatch.state);
    addSet(sets, values, 'error', input.runPatch.error);
    addSet(sets, values, 'started_at', input.runPatch.startedAt);
    addSet(sets, values, 'completed_at', input.runPatch.completedAt);
    sets.push('updated_at = now()');
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with inserted_approval as (
           insert into ${this.#schema}."WorkflowApproval"
             (id, run_id, node_id, approval_name, status, requested_at, resolved_at, resolved_by, decision, reason, assignees, expires_at, payload)
           select $1, $2, $3, $4, $5, now(), $6, $7, $8, $9, $10, $11, $12
           where ${guard}
           returning id
         ),
         inserted_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             $13,
             $2,
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $2), 1),
             $14,
             $15,
             $16,
             now()
           where exists (select 1 from inserted_approval)
           returning id
         )
         update ${this.#schema}."WorkflowRun"
         set ${sets.join(', ')}
         where id = $2 and exists (select 1 from inserted_timeline)
         returning *`,
        values,
      );
      return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
    });
  }

  async updateApproval(idValue: string, patch: Partial<WorkflowApprovalRecord>) {
    const values: unknown[] = [];
    const sets: string[] = [];
    addSet(sets, values, 'status', patch.status);
    addSet(sets, values, 'resolved_at', patch.resolvedAt);
    addSet(sets, values, 'resolved_by', patch.resolvedBy);
    addSet(sets, values, 'decision', patch.decision);
    addSet(sets, values, 'reason', patch.reason);
    addSet(sets, values, 'expires_at', patch.expiresAt);
    addSet(sets, values, 'payload', patch.payload);
    values.push(idValue);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowApproval" set ${sets.join(', ')} where id = $${values.length} returning *`,
        values,
      );
      return approvalFromRow(requireRow(result.rows[0], `Workflow approval not found: ${idValue}`));
    });
  }

  async resolveApprovalIfPending(
    input: ResolveApprovalIfPendingInput,
  ): Promise<WorkflowApprovalRecord | undefined> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowApproval"
         set status = $4,
             resolved_at = $5,
             resolved_by = $6,
             decision = $7,
             reason = $8
         where id = $1
           and run_id = $2
           and node_id = $3
           and status = 'pending'
         returning *`,
        [
          input.approvalId,
          input.runId,
          input.nodeId,
          input.status,
          input.resolvedAt ?? new Date(),
          input.resolvedBy,
          input.decision ?? null,
          input.reason ?? null,
        ],
      );
      return result.rows[0] ? approvalFromRow(result.rows[0]) : undefined;
    });
  }

  async resolveApprovalIfPendingIfLeased(
    input: LeasedApprovalResolveInput,
  ): Promise<WorkflowApprovalRecord | undefined> {
    if (input.guard.resourceType !== 'run' || input.guard.resourceId !== input.runId) {
      return undefined;
    }
    const values: unknown[] = [
      input.approvalId,
      input.runId,
      input.nodeId,
      input.status,
      input.resolvedAt ?? new Date(),
      input.resolvedBy,
      input.decision ?? null,
      input.reason ?? null,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowApproval" approval
         set status = $4,
             resolved_at = $5,
             resolved_by = $6,
             decision = $7,
             reason = $8
         where approval.id = $1
           and approval.run_id = $2
           and approval.node_id = $3
           and approval.status = 'pending'
           and exists (
             select 1
             from ${this.#schema}."WorkflowRun" run
             where run.id = approval.run_id
               and run.status = 'waiting_for_approval'
               and run.current_step = approval.node_id
           )
           and ${guard}
         returning approval.*`,
        values,
      );
      return result.rows[0] ? approvalFromRow(result.rows[0]) : undefined;
    });
  }

  async resolveApprovalAndUpdateRunIfLeased(
    input: LeasedApprovalRunUpdateInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (input.guard.resourceType !== 'run' || input.guard.resourceId !== input.runId) {
      return undefined;
    }
    const values: unknown[] = [
      input.approvalId,
      input.runId,
      input.nodeId,
      input.status,
      input.resolvedAt ?? new Date(),
      input.resolvedBy,
      input.decision ?? null,
      input.reason ?? null,
      id('tl'),
      input.event.type,
      input.event.nodeId ?? null,
      input.event.payload ?? null,
    ];
    const sets: string[] = [];
    addSet(sets, values, 'status', input.runPatch.status);
    if ('currentNode' in input.runPatch) {
      addNullableSet(sets, values, 'current_step', input.runPatch.currentNode);
    }
    addSet(sets, values, 'input', input.runPatch.input);
    addSet(sets, values, 'output', input.runPatch.output);
    addSet(sets, values, 'state', input.runPatch.state);
    addSet(sets, values, 'error', input.runPatch.error);
    addSet(sets, values, 'started_at', input.runPatch.startedAt);
    addSet(sets, values, 'completed_at', input.runPatch.completedAt);
    sets.push('updated_at = now()');
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with resolved_approval as (
           update ${this.#schema}."WorkflowApproval" approval
           set status = $4,
               resolved_at = $5,
               resolved_by = $6,
               decision = $7,
               reason = $8
           where approval.id = $1
             and approval.run_id = $2
             and approval.node_id = $3
             and approval.status = 'pending'
             and exists (
               select 1
               from ${this.#schema}."WorkflowRun" run
               where run.id = approval.run_id
                 and run.status = 'waiting_for_approval'
                 and run.current_step = approval.node_id
             )
             and ${guard}
           returning approval.id
         ),
         inserted_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             $9,
             $2,
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $2), 1),
             $10,
             $11,
             $12,
             now()
           where exists (select 1 from resolved_approval)
           returning id
         )
         update ${this.#schema}."WorkflowRun"
         set ${sets.join(', ')}
         where id = $2 and exists (select 1 from inserted_timeline)
         returning *`,
        values,
      );
      return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
    });
  }

  async findApproval(idValue: string): Promise<WorkflowApprovalRecord | undefined> {
    return this.#withClient(async (client) => {
      const result = await client.query(`${selectApprovals(this.#schema)} where id = $1`, [
        idValue,
      ]);
      return result.rows[0] ? approvalFromRow(result.rows[0]) : undefined;
    });
  }

  async pendingApprovals(): Promise<readonly WorkflowApprovalRecord[]> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `${selectApprovals(this.#schema)} where status = 'pending' order by requested_at`,
      );
      return result.rows.map(approvalFromRow);
    });
  }

  async pendingApprovalForRun(runId: string): Promise<WorkflowApprovalRecord | undefined> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `${selectApprovals(this.#schema)} where run_id = $1 and status = 'pending' order by requested_at desc limit 1`,
        [runId],
      );
      return result.rows[0] ? approvalFromRow(result.rows[0]) : undefined;
    });
  }

  async pendingApprovalForRunNode(
    runId: string,
    nodeId: string,
  ): Promise<WorkflowApprovalRecord | undefined> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `${selectApprovals(this.#schema)} where run_id = $1 and node_id = $2 and status = 'pending' order by requested_at desc limit 1`,
        [runId, nodeId],
      );
      return result.rows[0] ? approvalFromRow(result.rows[0]) : undefined;
    });
  }

  async readyApprovals(now = new Date()): Promise<readonly WorkflowApprovalRecord[]> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `${selectApprovals(this.#schema)}
         where status = 'pending' and expires_at is not null and expires_at <= $1
         order by expires_at`,
        [now],
      );
      return result.rows.map(approvalFromRow);
    });
  }

  async createTriggerMatch(match: Omit<WorkflowTriggerMatchRecord, 'id' | 'createdAt'>) {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowTriggerMatch"
           (id, ingest_event_id, workflow_id, version_id, created_at)
         values ($1, $2, $3, $4, now())
         on conflict (ingest_event_id, workflow_id, version_id) do update set ingest_event_id = excluded.ingest_event_id
         returning *`,
        [id('match'), match.ingestEventId, match.workflowId, match.versionId],
      );
      return triggerMatchFromRow(requireRow(result.rows[0]));
    });
  }

  async acquireLease(input: {
    readonly resourceType: WorkflowLeaseRecord['resourceType'];
    readonly resourceId: string;
    readonly workerId: string;
    readonly ttlMs: number;
    readonly now?: Date;
  }): Promise<WorkflowLeaseRecord | undefined> {
    const now = input.now ?? new Date();
    const lockedUntil = new Date(now.valueOf() + input.ttlMs);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowLease"
           (id, resource_type, resource_id, worker_id, locked_until, heartbeat_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (resource_type, resource_id) do update
           set id = excluded.id,
               worker_id = excluded.worker_id,
               locked_until = excluded.locked_until,
               heartbeat_at = excluded.heartbeat_at
         where ${this.#schema}."WorkflowLease".locked_until <= excluded.heartbeat_at
         returning *`,
        [id('lease'), input.resourceType, input.resourceId, input.workerId, lockedUntil, now],
      );
      return result.rows[0] ? leaseFromRow(result.rows[0]) : undefined;
    });
  }

  async extendLease(input: ExtendWorkflowLeaseInput): Promise<WorkflowLeaseRecord | undefined> {
    const now = input.now ?? new Date();
    const lockedUntil = new Date(now.valueOf() + input.ttlMs);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowLease"
         set locked_until = $4, heartbeat_at = $5
         where resource_type = $1
           and resource_id = $2
           and worker_id = $3
           and id = $6
           and locked_until > $5
         returning *`,
        [input.resourceType, input.resourceId, input.workerId, lockedUntil, now, input.leaseId],
      );
      return result.rows[0] ? leaseFromRow(result.rows[0]) : undefined;
    });
  }

  async releaseLease(
    resourceType: WorkflowLeaseRecord['resourceType'],
    resourceId: string,
    workerId?: string,
    leaseId?: string,
  ): Promise<void> {
    await this.#withClient(async (client) => {
      if (workerId === undefined) {
        await client.query(
          `delete from ${this.#schema}."WorkflowLease" where resource_type = $1 and resource_id = $2`,
          [resourceType, resourceId],
        );
        return;
      }
      if (leaseId !== undefined) {
        await client.query(
          `delete from ${this.#schema}."WorkflowLease"
           where resource_type = $1 and resource_id = $2 and worker_id = $3 and id = $4`,
          [resourceType, resourceId, workerId, leaseId],
        );
        return;
      }
      await client.query(
        `delete from ${this.#schema}."WorkflowLease"
         where resource_type = $1 and resource_id = $2 and worker_id = $3`,
        [resourceType, resourceId, workerId],
      );
    });
  }

  async createTimer(timer: Omit<WorkflowTimerRecord, 'id' | 'createdAt'>) {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowTimer" (id, run_id, node_id, resume_at, status, payload, created_at)
         values ($1, $2, $3, $4, $5, $6, now())
         returning *`,
        [
          id('timer'),
          timer.runId,
          timer.nodeId,
          timer.resumeAt,
          timer.status,
          timer.payload ?? null,
        ],
      );
      return timerFromRow(requireRow(result.rows[0]));
    });
  }

  async createTimerIfLeased(
    input: LeasedTimerCreateInput,
  ): Promise<WorkflowTimerRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.timer.runId)) return undefined;
    const values: unknown[] = [
      id('timer'),
      input.timer.runId,
      input.timer.nodeId,
      input.timer.resumeAt,
      input.timer.status,
      input.timer.payload ?? null,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowTimer" (id, run_id, node_id, resume_at, status, payload, created_at)
         select $1, $2, $3, $4, $5, $6, now()
         where ${guard}
         returning *`,
        values,
      );
      return result.rows[0] ? timerFromRow(result.rows[0]) : undefined;
    });
  }

  async updateTimer(idValue: string, patch: Partial<WorkflowTimerRecord>) {
    const values: unknown[] = [];
    const sets: string[] = [];
    addSet(sets, values, 'resume_at', patch.resumeAt);
    addSet(sets, values, 'status', patch.status);
    addSet(sets, values, 'payload', patch.payload);
    values.push(idValue);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowTimer" set ${sets.join(', ')} where id = $${values.length} returning *`,
        values,
      );
      return timerFromRow(requireRow(result.rows[0], `Workflow timer not found: ${idValue}`));
    });
  }

  async updateTimerIfLeased(
    input: LeasedTimerUpdateInput,
  ): Promise<WorkflowTimerRecord | undefined> {
    if (!isResourceLeaseGuard(input.guard, 'timer', input.timerId)) return undefined;
    const values: unknown[] = [];
    const sets: string[] = [];
    addSet(sets, values, 'resume_at', input.patch.resumeAt);
    addSet(sets, values, 'status', input.patch.status);
    addSet(sets, values, 'payload', input.patch.payload);
    values.push(input.timerId);
    const timerIdParam = values.length;
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowTimer"
         set ${sets.join(', ')}
         where id = $${timerIdParam} and ${guard}
         returning *`,
        values,
      );
      return result.rows[0] ? timerFromRow(result.rows[0]) : undefined;
    });
  }

  async readyTimers(now = new Date()): Promise<readonly WorkflowTimerRecord[]> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `${selectTimers(this.#schema)} where status = 'scheduled' and resume_at <= $1 order by resume_at`,
        [now],
      );
      return result.rows.map(timerFromRow);
    });
  }

  async createOutbox(outbox: Omit<WorkflowOutboxRecord, 'id' | 'createdAt'>) {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowOutbox"
           (id, run_id, node_id, idempotency_key, destination, payload, status, attempt, available_at, error, created_at, dispatched_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
         on conflict (destination, idempotency_key) where idempotency_key is not null
         do update set idempotency_key = ${this.#schema}."WorkflowOutbox".idempotency_key
         returning *`,
        [
          id('outbox'),
          outbox.runId,
          outbox.nodeId,
          outbox.idempotencyKey ?? null,
          outbox.destination,
          outbox.payload,
          outbox.status,
          outbox.attempt ?? 1,
          outbox.availableAt ?? null,
          outbox.error ?? null,
          outbox.dispatchedAt ?? null,
        ],
      );
      return outboxFromRow(requireRow(result.rows[0]));
    });
  }

  async createOutboxIfLeased(
    input: LeasedOutboxCreateInput,
  ): Promise<WorkflowOutboxRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.outbox.runId)) return undefined;
    const values: unknown[] = [
      id('outbox'),
      input.outbox.runId,
      input.outbox.nodeId,
      input.outbox.idempotencyKey ?? null,
      input.outbox.destination,
      input.outbox.payload,
      input.outbox.status,
      input.outbox.attempt ?? 1,
      input.outbox.availableAt ?? null,
      input.outbox.error ?? null,
      input.outbox.dispatchedAt ?? null,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with inserted as (
           insert into ${this.#schema}."WorkflowOutbox"
             (id, run_id, node_id, idempotency_key, destination, payload, status, attempt, available_at, error, created_at, dispatched_at)
           select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11
           where ${guard}
           on conflict (destination, idempotency_key) where idempotency_key is not null
           do nothing
           returning *
         )
         select * from inserted
         union all
         select existing.*
         from ${this.#schema}."WorkflowOutbox" existing
         where $4 is not null
           and existing.destination = $5
           and existing.idempotency_key = $4
           and ${guard}
         limit 1`,
        values,
      );
      return result.rows[0] ? outboxFromRow(result.rows[0]) : undefined;
    });
  }

  async createExternalStepOutboxAndPauseIfLeased(
    input: LeasedExternalStepOutboxPauseInput,
  ): Promise<WorkflowExternalStepOutboxPauseResult | undefined> {
    if (!isRunLeaseGuard(input.guard, input.step.runId)) return undefined;
    const claimOutboxLeaseNow = input.claimOutboxLease?.now ?? new Date();
    const claimOutboxLeaseUntil =
      input.claimOutboxLease === undefined
        ? null
        : new Date(claimOutboxLeaseNow.valueOf() + input.claimOutboxLease.ttlMs);
    const values: unknown[] = [
      id('step'),
      input.step.runId,
      input.step.nodeId,
      input.step.stepName,
      input.step.attempt,
      input.step.status,
      input.step.input ?? null,
      input.step.error ?? null,
      input.step.startedAt ?? null,
      input.step.completedAt ?? null,
      id('outbox'),
      input.outbox.idempotencyKey ?? null,
      input.outbox.destination,
      input.outbox.payload,
      input.outbox.status,
      input.outbox.attempt ?? 1,
      input.outbox.availableAt ?? null,
      input.outbox.error ?? null,
      input.outbox.dispatchedAt ?? null,
      id('tl'),
      input.runPatch.status,
      input.runPatch.currentNode,
      id('lease'),
      input.claimOutboxLease?.workerId ?? null,
      claimOutboxLeaseUntil,
      input.claimOutboxLease === undefined ? null : claimOutboxLeaseNow,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with inserted_outbox as (
           insert into ${this.#schema}."WorkflowOutbox"
             (id, run_id, node_id, idempotency_key, destination, payload, status, attempt, available_at, error, created_at, dispatched_at)
           select
             $11,
             $2,
             $3,
             $12,
             $13,
             jsonb_set($14::jsonb, '{stepRunId}', to_jsonb($1::text), true),
             $15,
             $16,
             $17,
             $18,
             now(),
             $19
           where ${guard}
           on conflict (destination, idempotency_key) where idempotency_key is not null
           do nothing
           returning *
         ),
         selected_outbox as (
           select * from inserted_outbox
           union all
           select existing.*
           from ${this.#schema}."WorkflowOutbox" existing
           where $12 is not null
             and existing.destination = $13
             and existing.idempotency_key = $12
             and ${guard}
           limit 1
         ),
         pending_outbox as (
           select *
           from selected_outbox
           where status = 'pending'
           limit 1
         ),
         inserted_step as (
           insert into ${this.#schema}."WorkflowStepRun"
             (id, run_id, node_id, step_name, attempt, status, input, output, error, started_at, completed_at, created_at)
           select $1, $2, $3, $4, $5, $6, $7, null, $8, $9, $10, now()
	          where exists (select 1 from pending_outbox)
	          returning *
         ),
         updated_waiter_step as (
           update ${this.#schema}."WorkflowStepRun"
           set status = 'queued',
               output = jsonb_build_object('outboxId', (select id from pending_outbox))
           where id = $1
             and exists (select 1 from inserted_step)
             and (select payload ->> 'stepRunId' from pending_outbox) <> $1
           returning *
         ),
         selected_step as (
           select * from updated_waiter_step
           union all
           select inserted_step.*
           from inserted_step
           where not exists (select 1 from updated_waiter_step)
           limit 1
         ),
         inserted_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             $20,
             $2,
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $2), 1),
             case
               when pending_outbox.payload ->> 'stepRunId' = $1 then 'OUTBOX_PENDING'
               else 'OUTBOX_WAITING'
             end,
             $3,
             jsonb_build_object('outboxId', pending_outbox.id, 'destination', pending_outbox.destination),
             now()
           from pending_outbox
           where exists (select 1 from inserted_step)
           returning id
         ),
         claimed_outbox_lease as (
           insert into ${this.#schema}."WorkflowLease"
             (id, resource_type, resource_id, worker_id, locked_until, heartbeat_at)
           select $23, 'outbox', pending_outbox.id, $24, $25, $26
           from pending_outbox
           where $24::text is not null
           on conflict (resource_type, resource_id) do update
             set id = excluded.id,
                 worker_id = excluded.worker_id,
                 locked_until = excluded.locked_until,
                 heartbeat_at = excluded.heartbeat_at
           where ${this.#schema}."WorkflowLease".locked_until <= excluded.heartbeat_at
           returning *
         ),
         updated_run as (
           update ${this.#schema}."WorkflowRun"
           set status = $21,
               current_step = $22,
               updated_at = now()
           where id = $2 and exists (select 1 from inserted_timeline)
           returning *
         )
         select row_to_json(updated_run) as run,
                row_to_json(pending_outbox) as outbox,
                row_to_json(selected_step) as step,
                (select row_to_json(claimed_outbox_lease) from claimed_outbox_lease) as outbox_lease
         from updated_run
         cross join pending_outbox
         cross join selected_step`,
        values,
      );
      const row = result.rows[0];
      return row
        ? {
            run: runFromRow(recordJson(row, 'run')),
            outbox: outboxFromRow(recordJson(row, 'outbox')),
            stepRun: stepRunFromRow(recordJson(row, 'step')),
            ...(row['outbox_lease']
              ? { outboxLease: leaseFromRow(recordJson(row, 'outbox_lease')) }
              : {}),
          }
        : undefined;
    });
  }

  async claimNextOutbox(input: ClaimNextOutboxInput): Promise<WorkflowOutboxRecord | undefined> {
    return (await this.claimNextOutboxWithLease(input))?.outbox;
  }

  async claimNextOutboxWithLease(
    input: ClaimNextOutboxInput,
  ): Promise<WorkflowOutboxClaim | undefined> {
    const now = input.now ?? new Date();
    const lockedUntil = new Date(now.valueOf() + input.ttlMs);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with candidate as (
             select o.*
             from ${this.#schema}."WorkflowOutbox" o
             left join ${this.#schema}."WorkflowLease" l
             on l.resource_type = 'outbox' and l.resource_id = o.id
             where o.status = 'pending'
               and (o.available_at is null or o.available_at <= $1)
               and (l.id is null or l.locked_until <= $1)
             order by coalesce(o.available_at, o.created_at), o.created_at
             for update of o skip locked
             limit 1
           ),
           claimed as (
             insert into ${this.#schema}."WorkflowLease"
               (id, resource_type, resource_id, worker_id, locked_until, heartbeat_at)
             select $3, 'outbox', candidate.id, $2, $4, $1
             from candidate
             on conflict (resource_type, resource_id) do update
               set id = excluded.id,
                   worker_id = excluded.worker_id,
                   locked_until = excluded.locked_until,
                   heartbeat_at = excluded.heartbeat_at
             where ${this.#schema}."WorkflowLease".locked_until <= excluded.heartbeat_at
             returning *
           )
           select candidate.*,
                  claimed.id as lease_id,
                  claimed.resource_type as lease_resource_type,
                  claimed.resource_id as lease_resource_id,
                  claimed.worker_id as lease_worker_id,
                  claimed.locked_until as lease_locked_until,
                  claimed.heartbeat_at as lease_heartbeat_at
           from candidate
           join claimed on claimed.resource_id = candidate.id`,
        [now, input.workerId, id('lease'), lockedUntil],
      );
      return result.rows[0]
        ? { outbox: outboxFromRow(result.rows[0]), lease: leaseFromClaimRow(result.rows[0]) }
        : undefined;
    });
  }

  async claimNextOutboxAndRunWithLeases(
    input: ClaimNextOutboxAndRunInput,
  ): Promise<WorkflowOutboxRunClaim | undefined> {
    const now = input.now ?? new Date();
    const outboxLockedUntil = new Date(now.valueOf() + input.ttlMs);
    const runLockedUntil = new Date(now.valueOf() + input.runTtlMs);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with candidate as (
             select o.*,
                    r.id as claimed_run_id,
                    r.workflow_id as claimed_run_workflow_id,
                    r.version_id as claimed_run_version_id,
                    r.ingest_event_id as claimed_run_ingest_event_id,
                    r.status as claimed_run_status,
                    r.current_step as claimed_run_current_step,
                    r.input as claimed_run_input,
                    r.output as claimed_run_output,
                    r.state as claimed_run_state,
                    r.error as claimed_run_error,
                    r.started_at as claimed_run_started_at,
                    r.completed_at as claimed_run_completed_at,
                    r.created_at as claimed_run_created_at,
                    r.updated_at as claimed_run_updated_at,
                    s.id as claimed_step_id,
                    s.run_id as claimed_step_run_id,
                    s.node_id as claimed_step_node_id,
                    s.step_name as claimed_step_step_name,
                    s.attempt as claimed_step_attempt,
                    s.status as claimed_step_status,
                    s.input as claimed_step_input,
                    s.output as claimed_step_output,
                    s.error as claimed_step_error,
                    s.started_at as claimed_step_started_at,
                    s.completed_at as claimed_step_completed_at,
                    s.created_at as claimed_step_created_at
             from ${this.#schema}."WorkflowOutbox" o
             join ${this.#schema}."WorkflowRun" r on r.id = o.run_id
             join ${this.#schema}."WorkflowStepRun" s
               on s.id = o.payload ->> 'stepRunId'
              and s.run_id = o.run_id
              and s.node_id = o.node_id
             left join ${this.#schema}."WorkflowLease" outbox_lease
               on outbox_lease.resource_type = 'outbox' and outbox_lease.resource_id = o.id
             left join ${this.#schema}."WorkflowLease" run_lease
               on run_lease.resource_type = 'run' and run_lease.resource_id = r.id
             where o.status = 'pending'
               and (o.available_at is null or o.available_at <= $1)
               and (outbox_lease.id is null or outbox_lease.locked_until <= $1)
               and r.status = any($7::text[])
               and (run_lease.id is null or run_lease.locked_until <= $1)
             order by coalesce(o.available_at, o.created_at), o.created_at
             for update of o, r skip locked
             limit 1
           ),
           claimed_outbox as (
             insert into ${this.#schema}."WorkflowLease"
               (id, resource_type, resource_id, worker_id, locked_until, heartbeat_at)
             select $3, 'outbox', candidate.id, $2, $4, $1
             from candidate
             on conflict (resource_type, resource_id) do update
               set id = excluded.id,
                   worker_id = excluded.worker_id,
                   locked_until = excluded.locked_until,
                   heartbeat_at = excluded.heartbeat_at
             where ${this.#schema}."WorkflowLease".locked_until <= excluded.heartbeat_at
             returning *
           ),
           claimed_run as (
             insert into ${this.#schema}."WorkflowLease"
               (id, resource_type, resource_id, worker_id, locked_until, heartbeat_at)
             select $5, 'run', candidate.run_id, $2, $6, $1
             from candidate
             where exists (select 1 from claimed_outbox)
             on conflict (resource_type, resource_id) do update
               set id = excluded.id,
                   worker_id = excluded.worker_id,
                   locked_until = excluded.locked_until,
                   heartbeat_at = excluded.heartbeat_at
             where ${this.#schema}."WorkflowLease".locked_until <= excluded.heartbeat_at
             returning *
           )
           select candidate.*,
                  claimed_outbox.id as lease_id,
                  claimed_outbox.resource_type as lease_resource_type,
                  claimed_outbox.resource_id as lease_resource_id,
                  claimed_outbox.worker_id as lease_worker_id,
                  claimed_outbox.locked_until as lease_locked_until,
                  claimed_outbox.heartbeat_at as lease_heartbeat_at,
                  claimed_run.id as run_lease_id,
                  claimed_run.resource_type as run_lease_resource_type,
                  claimed_run.resource_id as run_lease_resource_id,
                  claimed_run.worker_id as run_lease_worker_id,
                  claimed_run.locked_until as run_lease_locked_until,
                  claimed_run.heartbeat_at as run_lease_heartbeat_at
           from candidate
           join claimed_outbox on claimed_outbox.resource_id = candidate.id
           join claimed_run on claimed_run.resource_id = candidate.run_id`,
        [
          now,
          input.workerId,
          id('lease'),
          outboxLockedUntil,
          id('lease'),
          runLockedUntil,
          CLAIMABLE_RUN_STATUSES,
        ],
      );
      return result.rows[0]
        ? {
            outbox: outboxFromRow(result.rows[0]),
            outboxLease: leaseFromClaimRow(result.rows[0]),
            run: runFromPrefixedRow(result.rows[0], 'claimed_run_'),
            runLease: leaseFromPrefixedClaimRow(result.rows[0], 'run_lease_'),
            stepRun: stepRunFromPrefixedRow(result.rows[0], 'claimed_step_'),
          }
        : undefined;
    });
  }

  async updateOutbox(idValue: string, patch: Partial<WorkflowOutboxRecord>) {
    const values: unknown[] = [];
    const sets: string[] = [];
    addSet(sets, values, 'idempotency_key', patch.idempotencyKey);
    addSet(sets, values, 'destination', patch.destination);
    addSet(sets, values, 'payload', patch.payload);
    addSet(sets, values, 'status', patch.status);
    addSet(sets, values, 'attempt', patch.attempt);
    addSet(sets, values, 'available_at', patch.availableAt);
    addSet(sets, values, 'error', patch.error);
    addSet(sets, values, 'dispatched_at', patch.dispatchedAt);
    values.push(idValue);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowOutbox" set ${sets.join(', ')} where id = $${values.length} returning *`,
        values,
      );
      return outboxFromRow(requireRow(result.rows[0], `Workflow outbox not found: ${idValue}`));
    });
  }

  async updateOutboxIfLeased(
    input: LeasedOutboxUpdateInput,
  ): Promise<WorkflowOutboxRecord | undefined> {
    if (!isResourceLeaseGuard(input.guard, 'outbox', input.outboxId)) return undefined;
    const values: unknown[] = [];
    const sets: string[] = [];
    addSet(sets, values, 'idempotency_key', input.patch.idempotencyKey);
    addSet(sets, values, 'destination', input.patch.destination);
    addSet(sets, values, 'payload', input.patch.payload);
    addSet(sets, values, 'status', input.patch.status);
    addSet(sets, values, 'attempt', input.patch.attempt);
    addSet(sets, values, 'available_at', input.patch.availableAt);
    addSet(sets, values, 'error', input.patch.error);
    addSet(sets, values, 'dispatched_at', input.patch.dispatchedAt);
    values.push(input.outboxId);
    const outboxIdParam = values.length;
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `update ${this.#schema}."WorkflowOutbox"
         set ${sets.join(', ')}
         where id = $${outboxIdParam} and ${guard}
         returning *`,
        values,
      );
      return result.rows[0] ? outboxFromRow(result.rows[0]) : undefined;
    });
  }

  async updateOutboxAndAppendTimelineIfLeased(
    input: LeasedOutboxTimelineUpdateInput,
  ): Promise<WorkflowOutboxRecord | undefined> {
    if (!isResourceLeaseGuard(input.guard, 'outbox', input.outboxId)) return undefined;
    const values: unknown[] = [];
    const sets: string[] = [];
    addSet(sets, values, 'idempotency_key', input.patch.idempotencyKey);
    addSet(sets, values, 'destination', input.patch.destination);
    addSet(sets, values, 'payload', input.patch.payload);
    addSet(sets, values, 'status', input.patch.status);
    addSet(sets, values, 'attempt', input.patch.attempt);
    addSet(sets, values, 'available_at', input.patch.availableAt);
    addSet(sets, values, 'error', input.patch.error);
    addSet(sets, values, 'dispatched_at', input.patch.dispatchedAt);
    values.push(input.outboxId);
    const outboxIdParam = values.length;
    values.push(id('tl'));
    const timelineIdParam = values.length;
    values.push(input.event.runId);
    const runIdParam = values.length;
    values.push(input.event.type);
    const typeParam = values.length;
    values.push(input.event.nodeId ?? null);
    const nodeIdParam = values.length;
    values.push(input.event.payload ?? null);
    const payloadParam = values.length;
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with updated_outbox as (
           update ${this.#schema}."WorkflowOutbox"
           set ${sets.join(', ')}
           where id = $${outboxIdParam} and ${guard}
           returning *
         ),
         inserted_timeline as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             $${timelineIdParam},
             $${runIdParam},
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowTimelineEvent" where run_id = $${runIdParam}), 1),
             $${typeParam},
             $${nodeIdParam},
             $${payloadParam},
             now()
           where exists (select 1 from updated_outbox)
           returning id
         )
         select updated_outbox.*
         from updated_outbox
         where exists (select 1 from inserted_timeline)`,
        values,
      );
      return result.rows[0] ? outboxFromRow(result.rows[0]) : undefined;
    });
  }

  async completeOutboxDispatchAndAdvanceIfLeased(
    input: LeasedOutboxDispatchCompletionInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (
      !isRunLeaseGuard(input.runGuard, input.runId) ||
      !isResourceLeaseGuard(input.outboxGuard, 'outbox', input.outboxId)
    ) {
      return undefined;
    }
    const values: unknown[] = [
      input.stepRunId,
      input.runId,
      input.stepOutput ?? null,
      input.completedAt,
      id('tl'),
      input.stepCompletedEvent.type,
      input.stepCompletedEvent.nodeId ?? null,
      input.stepCompletedEvent.payload ?? null,
      id('tl'),
      input.outboxDispatchedEvent.type,
      input.outboxDispatchedEvent.nodeId ?? null,
      input.outboxDispatchedEvent.payload ?? null,
      id('snap'),
      input.snapshot.nodeId ?? null,
      input.snapshot.state,
      input.snapshot.diff ?? null,
      input.runPatch.state,
      input.runPatch.currentNode ?? null,
      input.runPatch.status,
      input.runPatch.error ?? null,
      input.outboxId,
      input.outboxPatch.status,
      input.outboxPatch.attempt,
      input.outboxPatch.dispatchedAt ?? null,
      input.outboxPatch.error ?? null,
      input.outboxPatch.payload,
      id('tl'),
      input.outboxDispatchStartedEvent?.type ?? null,
      input.outboxDispatchStartedEvent?.nodeId ?? null,
      input.outboxDispatchStartedEvent?.payload ?? null,
    ];
    const runGuard = activeLeasePredicate(this.#schema, values, input.runGuard);
    const outboxGuard = activeLeasePredicate(this.#schema, values, input.outboxGuard);
    let releaseOutboxLeaseCte = '';
    if (input.releaseOutboxLease) {
      values.push(input.outboxGuard.leaseId);
      const leaseIdParam = values.length;
      values.push(input.outboxGuard.resourceType);
      const resourceTypeParam = values.length;
      values.push(input.outboxGuard.resourceId);
      const resourceIdParam = values.length;
      values.push(input.outboxGuard.workerId);
      const workerIdParam = values.length;
      releaseOutboxLeaseCte = `,
         released_outbox_lease as (
           delete from ${this.#schema}."WorkflowLease"
           where id = $${leaseIdParam}
             and resource_type = $${resourceTypeParam}
             and resource_id = $${resourceIdParam}
             and worker_id = $${workerIdParam}
             and exists (select 1 from updated_run)
           returning id
         )`;
    }
    return this.#withClient(async (client) => {
      const result = await client.query(
        `with lease_guards as (
           select 1 where ${runGuard} and ${outboxGuard}
         ),
         outbox_candidate as (
           select id
           from ${this.#schema}."WorkflowOutbox"
           where id = $21 and exists (select 1 from lease_guards)
         ),
         updated_step as (
           update ${this.#schema}."WorkflowStepRun"
           set status = 'completed',
               output = $3,
               completed_at = $4
           where id = $1
             and run_id = $2
             and exists (select 1 from outbox_candidate)
           returning id
         ),
         updated_outbox as (
           update ${this.#schema}."WorkflowOutbox"
           set status = $22,
               attempt = $23,
               dispatched_at = $24,
               error = $25,
               payload = $26
           where id = $21
             and exists (select 1 from updated_step)
           returning id
         ),
         timeline_rows(id, type, node_id, payload, ordinal) as (
           values
             ($27, $28, $29, $30::jsonb, 1),
             ($5, $6, $7, $8::jsonb, 2),
             ($9, $10, $11, $12::jsonb, 3)
         ),
         timeline_base(sequence) as (
           select coalesce(max(sequence), 0)
           from ${this.#schema}."WorkflowTimelineEvent"
           where run_id = $2
         ),
         inserted_timelines as (
           insert into ${this.#schema}."WorkflowTimelineEvent"
             (id, run_id, sequence, type, node_id, payload, created_at)
           select
             timeline_rows.id,
             $2,
             timeline_base.sequence + timeline_rows.ordinal,
             timeline_rows.type,
             timeline_rows.node_id,
             timeline_rows.payload,
             now()
           from timeline_rows
           cross join timeline_base
           where exists (select 1 from updated_outbox)
             and timeline_rows.type is not null
           returning id
         ),
         inserted_snapshot as (
           insert into ${this.#schema}."WorkflowStateSnapshot"
             (id, run_id, sequence, node_id, state, diff, created_at)
           select
             $13,
             $2,
             coalesce((select max(sequence) + 1 from ${this.#schema}."WorkflowStateSnapshot" where run_id = $2), 1),
             $14,
             $15,
             $16,
             now()
           where (select count(*) from inserted_timelines) = case when $28::text is null then 2 else 3 end
           returning id
         ),
         updated_run as (
           update ${this.#schema}."WorkflowRun"
           set state = $17,
               current_step = $18,
               status = $19,
               error = $20,
               updated_at = now()
           where id = $2 and exists (select 1 from inserted_snapshot)
           returning *
         )${releaseOutboxLeaseCte}
         select * from updated_run`,
        values,
      );
      return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
    });
  }

  async findOutboxWaiters(outboxId: string): Promise<readonly WorkflowStepRunRecord[]> {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `${selectStepRuns(this.#schema)}
         where status = 'queued' and output ->> 'outboxId' = $1
         order by created_at`,
        [outboxId],
      );
      return result.rows.map(stepRunFromRow);
    });
  }

  async createDeadLetter(deadLetter: Omit<WorkflowDeadLetterRecord, 'id' | 'createdAt'>) {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowDeadLetter"
           (id, kind, resource_id, reason, payload, created_at, resolved_at)
         values ($1, $2, $3, $4, $5, now(), $6)
         returning *`,
        [
          id('dlq'),
          deadLetter.kind,
          deadLetter.resourceId,
          deadLetter.reason,
          deadLetter.payload ?? null,
          deadLetter.resolvedAt ?? null,
        ],
      );
      return deadLetterFromRow(requireRow(result.rows[0]));
    });
  }

  async createDeadLetterIfLeased(
    input: LeasedDeadLetterCreateInput,
  ): Promise<WorkflowDeadLetterRecord | undefined> {
    if (!isRunLeaseGuard(input.guard, input.deadLetter.resourceId)) return undefined;
    const values: unknown[] = [
      id('dlq'),
      input.deadLetter.kind,
      input.deadLetter.resourceId,
      input.deadLetter.reason,
      input.deadLetter.payload ?? null,
      input.deadLetter.resolvedAt ?? null,
    ];
    const guard = activeLeasePredicate(this.#schema, values, input.guard);
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowDeadLetter"
           (id, kind, resource_id, reason, payload, created_at, resolved_at)
         select $1, $2, $3, $4, $5, now(), $6
         where ${guard}
         returning *`,
        values,
      );
      return result.rows[0] ? deadLetterFromRow(result.rows[0]) : undefined;
    });
  }

  async createArtifact(artifact: Omit<WorkflowArtifactRecord, 'id' | 'createdAt'>) {
    return this.#withClient(async (client) => {
      const result = await client.query(
        `insert into ${this.#schema}."WorkflowArtifact" (id, run_id, kind, uri, payload, created_at)
         values ($1, $2, $3, $4, $5, now())
         returning *`,
        [
          id('artifact'),
          artifact.runId ?? null,
          artifact.kind,
          artifact.uri ?? null,
          artifact.payload ?? null,
        ],
      );
      return artifactFromRow(requireRow(result.rows[0]));
    });
  }

  async #withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.#ready;
    const client = await this.#pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
}

function selectDefinitions(schema: string): string {
  return `select id, name, slug, created_at, updated_at from ${schema}."WorkflowDefinition"`;
}

function selectVersions(schema: string): string {
  return `select id, workflow_id, version, status, source_hash, compiled_graph, visual_graph, created_at from ${schema}."WorkflowVersion"`;
}

function selectIngestEvents(schema: string): string {
  return `select id, source, connector_account_id, external_id, event_type, dedupe_key, occurred_at, received_at, headers, raw_payload, normalized_payload, signature_verified, status, error from ${schema}."WorkflowIngestEvent"`;
}

function selectTriggerMatches(schema: string): string {
  return `select id, ingest_event_id, workflow_id, version_id, created_at from ${schema}."WorkflowTriggerMatch"`;
}

function selectRuns(schema: string): string {
  return `select id, workflow_id, version_id, ingest_event_id, status, current_step, input, output, state, error, started_at, completed_at, created_at, updated_at from ${schema}."WorkflowRun"`;
}

function selectStepRuns(schema: string): string {
  return `select id, run_id, node_id, step_name, attempt, status, input, output, error, started_at, completed_at, created_at from ${schema}."WorkflowStepRun"`;
}

function selectTimeline(schema: string): string {
  return `select id, run_id, sequence, type, node_id, payload, created_at from ${schema}."WorkflowTimelineEvent"`;
}

function selectStateSnapshots(schema: string): string {
  return `select id, run_id, sequence, node_id, state, diff, created_at from ${schema}."WorkflowStateSnapshot"`;
}

function selectApprovals(schema: string): string {
  return `select id, run_id, node_id, approval_name, status, requested_at, resolved_at, resolved_by, decision, reason, assignees, expires_at, payload from ${schema}."WorkflowApproval"`;
}

function selectLeases(schema: string): string {
  return `select id, resource_type, resource_id, worker_id, locked_until, heartbeat_at from ${schema}."WorkflowLease"`;
}

function selectTimers(schema: string): string {
  return `select id, run_id, node_id, resume_at, status, payload, created_at from ${schema}."WorkflowTimer"`;
}

function selectOutbox(schema: string): string {
  return `select id, run_id, node_id, idempotency_key, destination, payload, status, attempt, available_at, error, created_at, dispatched_at from ${schema}."WorkflowOutbox"`;
}

function selectDeadLetters(schema: string): string {
  return `select id, kind, resource_id, reason, payload, created_at, resolved_at from ${schema}."WorkflowDeadLetter"`;
}

function selectConnectorAccounts(schema: string): string {
  return `select id, connector, label, metadata, created_at from ${schema}."WorkflowConnectorAccount"`;
}

function selectConnectorCursors(schema: string): string {
  return `select id, connector, cursor_key, cursor_value, updated_at from ${schema}."WorkflowConnectorCursor"`;
}

function selectCanvasLayouts(schema: string): string {
  return `select id, workflow_id, version_id, layout, updated_at from ${schema}."WorkflowCanvasLayout"`;
}

function selectArtifacts(schema: string): string {
  return `select id, run_id, kind, uri, payload, created_at from ${schema}."WorkflowArtifact"`;
}

function insertIngestEvent(schema: string): string {
  return `insert into ${schema}."WorkflowIngestEvent"
    (id, source, connector_account_id, external_id, event_type, dedupe_key, occurred_at, headers, raw_payload, normalized_payload, signature_verified, status, error)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`;
}

function addSet(sets: string[], values: unknown[], column: string, value: unknown): void {
  if (value === undefined) return;
  values.push(value);
  sets.push(`${column} = $${values.length}`);
}

function addNullableSet(sets: string[], values: unknown[], column: string, value: unknown): void {
  values.push(value ?? null);
  sets.push(`${column} = $${values.length}`);
}

function activeLeasePredicate(
  schema: string,
  values: unknown[],
  guard: {
    readonly leaseId: string;
    readonly resourceType: WorkflowLeaseRecord['resourceType'];
    readonly resourceId: string;
    readonly workerId: string;
    readonly now?: Date;
  },
): string {
  values.push(guard.leaseId);
  const leaseIdParam = values.length;
  values.push(guard.resourceType);
  const resourceTypeParam = values.length;
  values.push(guard.resourceId);
  const resourceIdParam = values.length;
  values.push(guard.workerId);
  const workerIdParam = values.length;
  values.push(guard.now ?? new Date());
  const nowParam = values.length;
  return `exists (
    select 1
    from ${schema}."WorkflowLease"
    where id = $${leaseIdParam}
      and resource_type = $${resourceTypeParam}
      and resource_id = $${resourceIdParam}
      and worker_id = $${workerIdParam}
      and locked_until > $${nowParam}
  )`;
}

function isRunLeaseGuard(guard: WorkflowLeaseGuardInput, runId: string): boolean {
  return guard.resourceType === 'run' && guard.resourceId === runId;
}

function isResourceLeaseGuard(
  guard: WorkflowLeaseGuardInput,
  resourceType: WorkflowLeaseRecord['resourceType'],
  resourceId: string,
): boolean {
  return guard.resourceType === resourceType && guard.resourceId === resourceId;
}

async function latestSnapshotState(
  client: PoolClient,
  schema: string,
  runId: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await client.query(
    `${selectStateSnapshots(schema)} where run_id = $1 order by sequence desc limit 1`,
    [runId],
  );
  const row = result.rows[0];
  return row ? recordJson(row, 'state') : undefined;
}

function shallowDiff(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, { readonly before?: unknown; readonly after?: unknown }> {
  const out: Record<string, { readonly before?: unknown; readonly after?: unknown }> = {};
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(next)]);
  for (const key of keys) {
    const before = previous?.[key];
    const after = next[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      out[key] = {
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
      };
    }
  }
  return out;
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function requireRow<T extends QueryResultRow>(row: T | undefined, message = 'Expected row'): T {
  if (!row) {
    throw new Error(message);
  }
  return row;
}

function definitionFromRow(row: QueryResultRow): WorkflowDefinitionRecord {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    slug: text(row, 'slug'),
    createdAt: date(row, 'created_at'),
    updatedAt: date(row, 'updated_at'),
  };
}

function versionFromRow(row: QueryResultRow): WorkflowVersionRecord {
  return {
    id: text(row, 'id'),
    workflowId: text(row, 'workflow_id'),
    version: number(row, 'version'),
    status: text(row, 'status') === 'retired' ? 'retired' : 'active',
    sourceHash: text(row, 'source_hash'),
    compiledGraph: json(row, 'compiled_graph'),
    visualGraph: json(row, 'visual_graph'),
    createdAt: date(row, 'created_at'),
  };
}

function ingestEventFromRow(row: QueryResultRow): WorkflowIngestEventRecord {
  return {
    id: text(row, 'id'),
    source: text(row, 'source'),
    ...optional('connectorAccountId', nullableText(row, 'connector_account_id')),
    externalId: text(row, 'external_id'),
    eventType: text(row, 'event_type'),
    dedupeKey: text(row, 'dedupe_key'),
    ...optional('occurredAt', nullableDate(row, 'occurred_at')),
    receivedAt: date(row, 'received_at'),
    ...optional('headers', nullableStringRecord(row, 'headers')),
    rawPayload: json(row, 'raw_payload'),
    ...optional('normalizedPayload', nullableJson(row, 'normalized_payload')),
    signatureVerified: boolean(row, 'signature_verified'),
    status: ingestStatus(row, 'status'),
    ...optional('error', nullableText(row, 'error')),
  };
}

function runFromRow(row: QueryResultRow): WorkflowRunRecord {
  return {
    id: text(row, 'id'),
    workflowId: text(row, 'workflow_id'),
    versionId: text(row, 'version_id'),
    ...optional('ingestEventId', nullableText(row, 'ingest_event_id')),
    status: runStatus(row, 'status'),
    ...optional('currentNode', nullableText(row, 'current_step')),
    input: json(row, 'input'),
    ...optional('output', nullableJson(row, 'output')),
    state: recordJson(row, 'state'),
    ...optional('error', nullableJson(row, 'error')),
    ...optional('startedAt', nullableDate(row, 'started_at')),
    ...optional('completedAt', nullableDate(row, 'completed_at')),
    createdAt: date(row, 'created_at'),
    updatedAt: date(row, 'updated_at'),
  };
}

function runFromPrefixedRow(row: QueryResultRow, prefix: string): WorkflowRunRecord {
  return {
    id: text(row, `${prefix}id`),
    workflowId: text(row, `${prefix}workflow_id`),
    versionId: text(row, `${prefix}version_id`),
    ...optional('ingestEventId', nullableText(row, `${prefix}ingest_event_id`)),
    status: runStatus(row, `${prefix}status`),
    ...optional('currentNode', nullableText(row, `${prefix}current_step`)),
    input: json(row, `${prefix}input`),
    ...optional('output', nullableJson(row, `${prefix}output`)),
    state: recordJson(row, `${prefix}state`),
    ...optional('error', nullableJson(row, `${prefix}error`)),
    ...optional('startedAt', nullableDate(row, `${prefix}started_at`)),
    ...optional('completedAt', nullableDate(row, `${prefix}completed_at`)),
    createdAt: date(row, `${prefix}created_at`),
    updatedAt: date(row, `${prefix}updated_at`),
  };
}

function stepRunFromRow(row: QueryResultRow): WorkflowStepRunRecord {
  return {
    id: text(row, 'id'),
    runId: text(row, 'run_id'),
    nodeId: text(row, 'node_id'),
    stepName: text(row, 'step_name'),
    attempt: number(row, 'attempt'),
    status: stepStatus(row, 'status'),
    ...optional('input', nullableJson(row, 'input')),
    ...optional('output', nullableJson(row, 'output')),
    ...optional('error', nullableJson(row, 'error')),
    ...optional('startedAt', nullableDate(row, 'started_at')),
    ...optional('completedAt', nullableDate(row, 'completed_at')),
    createdAt: date(row, 'created_at'),
  };
}

function stepRunFromPrefixedRow(row: QueryResultRow, prefix: string): WorkflowStepRunRecord {
  return {
    id: text(row, `${prefix}id`),
    runId: text(row, `${prefix}run_id`),
    nodeId: text(row, `${prefix}node_id`),
    stepName: text(row, `${prefix}step_name`),
    attempt: number(row, `${prefix}attempt`),
    status: stepStatus(row, `${prefix}status`),
    ...optional('input', nullableJson(row, `${prefix}input`)),
    ...optional('output', nullableJson(row, `${prefix}output`)),
    ...optional('error', nullableJson(row, `${prefix}error`)),
    ...optional('startedAt', nullableDate(row, `${prefix}started_at`)),
    ...optional('completedAt', nullableDate(row, `${prefix}completed_at`)),
    createdAt: date(row, `${prefix}created_at`),
  };
}

function timelineFromRow(row: QueryResultRow): WorkflowTimelineEventRecord {
  return {
    id: text(row, 'id'),
    runId: text(row, 'run_id'),
    sequence: number(row, 'sequence'),
    type: text(row, 'type'),
    ...optional('nodeId', nullableText(row, 'node_id')),
    ...optional('payload', nullableJson(row, 'payload')),
    createdAt: date(row, 'created_at'),
  };
}

function stateSnapshotFromRow(row: QueryResultRow): WorkflowStateSnapshotRecord {
  return {
    id: text(row, 'id'),
    runId: text(row, 'run_id'),
    sequence: number(row, 'sequence'),
    ...optional('nodeId', nullableText(row, 'node_id')),
    state: recordJson(row, 'state'),
    ...optional('diff', nullableJson(row, 'diff')),
    createdAt: date(row, 'created_at'),
  };
}

function approvalFromRow(row: QueryResultRow): WorkflowApprovalRecord {
  return {
    id: text(row, 'id'),
    runId: text(row, 'run_id'),
    nodeId: text(row, 'node_id'),
    approvalName: text(row, 'approval_name'),
    status: approvalStatus(row, 'status'),
    requestedAt: date(row, 'requested_at'),
    ...optional('resolvedAt', nullableDate(row, 'resolved_at')),
    ...optional('resolvedBy', nullableText(row, 'resolved_by')),
    ...optional('decision', nullableJson(row, 'decision')),
    ...optional('reason', nullableText(row, 'reason')),
    assignees: stringArray(row, 'assignees'),
    ...optional('expiresAt', nullableDate(row, 'expires_at')),
    ...optional('payload', nullableJson(row, 'payload')),
  };
}

function triggerMatchFromRow(row: QueryResultRow): WorkflowTriggerMatchRecord {
  return {
    id: text(row, 'id'),
    ingestEventId: text(row, 'ingest_event_id'),
    workflowId: text(row, 'workflow_id'),
    versionId: text(row, 'version_id'),
    createdAt: date(row, 'created_at'),
  };
}

function leaseFromRow(row: QueryResultRow): WorkflowLeaseRecord {
  const resourceType = text(row, 'resource_type');
  return {
    id: text(row, 'id'),
    resourceType:
      resourceType === 'step' ||
      resourceType === 'timer' ||
      resourceType === 'run' ||
      resourceType === 'outbox'
        ? resourceType
        : 'run',
    resourceId: text(row, 'resource_id'),
    workerId: text(row, 'worker_id'),
    lockedUntil: date(row, 'locked_until'),
    heartbeatAt: date(row, 'heartbeat_at'),
  };
}

function leaseFromClaimRow(row: QueryResultRow): WorkflowLeaseRecord {
  const resourceType = text(row, 'lease_resource_type');
  return {
    id: text(row, 'lease_id'),
    resourceType:
      resourceType === 'step' ||
      resourceType === 'timer' ||
      resourceType === 'run' ||
      resourceType === 'outbox'
        ? resourceType
        : 'run',
    resourceId: text(row, 'lease_resource_id'),
    workerId: text(row, 'lease_worker_id'),
    lockedUntil: date(row, 'lease_locked_until'),
    heartbeatAt: date(row, 'lease_heartbeat_at'),
  };
}

function leaseFromPrefixedClaimRow(row: QueryResultRow, prefix: string): WorkflowLeaseRecord {
  const resourceType = text(row, `${prefix}resource_type`);
  return {
    id: text(row, `${prefix}id`),
    resourceType:
      resourceType === 'step' ||
      resourceType === 'timer' ||
      resourceType === 'run' ||
      resourceType === 'outbox'
        ? resourceType
        : 'run',
    resourceId: text(row, `${prefix}resource_id`),
    workerId: text(row, `${prefix}worker_id`),
    lockedUntil: date(row, `${prefix}locked_until`),
    heartbeatAt: date(row, `${prefix}heartbeat_at`),
  };
}

function timerFromRow(row: QueryResultRow): WorkflowTimerRecord {
  return {
    id: text(row, 'id'),
    runId: text(row, 'run_id'),
    nodeId: text(row, 'node_id'),
    resumeAt: date(row, 'resume_at'),
    status: timerStatus(row, 'status'),
    ...optional('payload', nullableJson(row, 'payload')),
    createdAt: date(row, 'created_at'),
  };
}

function outboxFromRow(row: QueryResultRow): WorkflowOutboxRecord {
  return {
    id: text(row, 'id'),
    runId: text(row, 'run_id'),
    nodeId: text(row, 'node_id'),
    ...optional('idempotencyKey', nullableText(row, 'idempotency_key')),
    destination: text(row, 'destination'),
    payload: json(row, 'payload'),
    status: outboxStatus(row, 'status'),
    ...optional('attempt', nullableNumber(row, 'attempt')),
    ...optional('availableAt', nullableDate(row, 'available_at')),
    ...optional('error', nullableJson(row, 'error')),
    createdAt: date(row, 'created_at'),
    ...optional('dispatchedAt', nullableDate(row, 'dispatched_at')),
  };
}

function deadLetterFromRow(row: QueryResultRow): WorkflowDeadLetterRecord {
  const kind = text(row, 'kind');
  return {
    id: text(row, 'id'),
    kind: kind === 'event' || kind === 'run' || kind === 'step' ? kind : 'run',
    resourceId: text(row, 'resource_id'),
    reason: text(row, 'reason'),
    ...optional('payload', nullableJson(row, 'payload')),
    createdAt: date(row, 'created_at'),
    ...optional('resolvedAt', nullableDate(row, 'resolved_at')),
  };
}

function connectorAccountFromRow(row: QueryResultRow): WorkflowConnectorAccountRecord {
  return {
    id: text(row, 'id'),
    connector: text(row, 'connector'),
    label: text(row, 'label'),
    ...optional('metadata', nullableJson(row, 'metadata')),
    createdAt: date(row, 'created_at'),
  };
}

function connectorCursorFromRow(row: QueryResultRow): WorkflowConnectorCursorRecord {
  return {
    id: text(row, 'id'),
    connector: text(row, 'connector'),
    cursorKey: text(row, 'cursor_key'),
    ...optional('cursorValue', nullableText(row, 'cursor_value')),
    updatedAt: date(row, 'updated_at'),
  };
}

function canvasLayoutFromRow(row: QueryResultRow): WorkflowCanvasLayoutRecord {
  return {
    id: text(row, 'id'),
    workflowId: text(row, 'workflow_id'),
    versionId: text(row, 'version_id'),
    layout: json(row, 'layout'),
    updatedAt: date(row, 'updated_at'),
  };
}

function artifactFromRow(row: QueryResultRow): WorkflowArtifactRecord {
  return {
    id: text(row, 'id'),
    ...optional('runId', nullableText(row, 'run_id')),
    kind: text(row, 'kind'),
    ...optional('uri', nullableText(row, 'uri')),
    ...optional('payload', nullableJson(row, 'payload')),
    createdAt: date(row, 'created_at'),
  };
}

function text(row: QueryResultRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string column ${key}`);
  }
  return value;
}

function nullableText(row: QueryResultRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === 'string' ? value : undefined;
}

function number(row: QueryResultRow, key: string): number {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  throw new Error(`Expected number column ${key}`);
}

function nullableNumber(row: QueryResultRow, key: string): number | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  return typeof value === 'number' ? value : Number(value);
}

function boolean(row: QueryResultRow, key: string): boolean {
  return row[key] === true;
}

function date(row: QueryResultRow, key: string): Date {
  const value = row[key];
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  throw new Error(`Expected date column ${key}`);
}

function nullableDate(row: QueryResultRow, key: string): Date | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  return value instanceof Date ? value : new Date(String(value));
}

function json<T>(row: QueryResultRow, key: string): T {
  return row[key];
}

function nullableJson(row: QueryResultRow, key: string): unknown | undefined {
  return row[key] === null || row[key] === undefined ? undefined : row[key];
}

function recordJson(row: QueryResultRow, key: string): Record<string, unknown> {
  const value = row[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  return {};
}

function stringArray(row: QueryResultRow, key: string): readonly string[] {
  const value = row[key];
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  const out: Partial<Record<K, V>> = {};
  if (value !== undefined) {
    out[key] = value;
  }
  return out;
}

function nullableStringRecord(
  row: QueryResultRow,
  key: string,
): Record<string, string> | undefined {
  const value = row[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return Object.fromEntries(entries);
}

function ingestStatus(row: QueryResultRow, key: string): WorkflowIngestEventRecord['status'] {
  const value = text(row, key);
  return value === 'received' || value === 'matched' || value === 'ignored' || value === 'failed'
    ? value
    : 'received';
}

function runStatus(row: QueryResultRow, key: string): WorkflowRunRecord['status'] {
  const value = text(row, key);
  return value === 'queued' ||
    value === 'running' ||
    value === 'waiting_for_approval' ||
    value === 'waiting_for_timer' ||
    value === 'paused' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
    ? value
    : 'failed';
}

function stepStatus(row: QueryResultRow, key: string): WorkflowStepRunRecord['status'] {
  const value = text(row, key);
  return value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped'
    ? value
    : 'failed';
}

function approvalStatus(row: QueryResultRow, key: string): WorkflowApprovalRecord['status'] {
  const value = text(row, key);
  return value === 'pending' || value === 'approved' || value === 'rejected' || value === 'expired'
    ? value
    : 'pending';
}

function timerStatus(row: QueryResultRow, key: string): WorkflowTimerRecord['status'] {
  const value = text(row, key);
  return value === 'scheduled' ||
    value === 'ready' ||
    value === 'completed' ||
    value === 'cancelled'
    ? value
    : 'scheduled';
}

function outboxStatus(row: QueryResultRow, key: string): WorkflowOutboxRecord['status'] {
  const value = text(row, key);
  return value === 'pending' || value === 'dispatched' || value === 'failed' ? value : 'pending';
}
