export const WORKFLOW_SCHEMA_NAME = '_prisma_workflows';

export function quoteWorkflowSqlIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function renderWorkflowSqlDdl(schemaName = WORKFLOW_SCHEMA_NAME): string {
  const schema = quoteWorkflowSqlIdentifier(schemaName);
  return `CREATE SCHEMA IF NOT EXISTS ${schema};

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowDefinition" (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowVersion" (
  id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES ${schema}."WorkflowDefinition"(id),
  version integer NOT NULL,
  status text NOT NULL,
  source_hash text NOT NULL,
  compiled_graph jsonb NOT NULL,
  visual_graph jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, version)
);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowIngestEvent" (
  id text PRIMARY KEY,
  source text NOT NULL,
  connector_account_id text,
  external_id text NOT NULL,
  event_type text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  headers jsonb,
  raw_payload jsonb NOT NULL,
  normalized_payload jsonb,
  signature_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'received',
  error text
);

CREATE INDEX IF NOT EXISTS "WorkflowIngestEvent_source_event_received_idx"
  ON ${schema}."WorkflowIngestEvent"(source, event_type, received_at);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowRun" (
  id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES ${schema}."WorkflowDefinition"(id),
  version_id text NOT NULL REFERENCES ${schema}."WorkflowVersion"(id),
  ingest_event_id text REFERENCES ${schema}."WorkflowIngestEvent"(id),
  status text NOT NULL,
  current_step text,
  input jsonb NOT NULL,
  output jsonb,
  state jsonb,
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "WorkflowRun_workflow_status_created_idx"
  ON ${schema}."WorkflowRun"(workflow_id, status, created_at);

CREATE INDEX IF NOT EXISTS "WorkflowRun_claim_rank_created_idx"
  ON ${schema}."WorkflowRun" (
    (CASE WHEN status = 'queued' THEN 0 ELSE 1 END),
    created_at,
    id
  )
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowStepRun" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES ${schema}."WorkflowRun"(id),
  node_id text NOT NULL,
  step_name text NOT NULL,
  attempt integer NOT NULL,
  status text NOT NULL,
  input jsonb,
  output jsonb,
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, node_id, attempt)
);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowTimelineEvent" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES ${schema}."WorkflowRun"(id),
  sequence integer NOT NULL,
  type text NOT NULL,
  node_id text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowStateSnapshot" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES ${schema}."WorkflowRun"(id),
  sequence integer NOT NULL,
  node_id text,
  state jsonb NOT NULL,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowTriggerMatch" (
  id text PRIMARY KEY,
  ingest_event_id text NOT NULL REFERENCES ${schema}."WorkflowIngestEvent"(id),
  workflow_id text NOT NULL REFERENCES ${schema}."WorkflowDefinition"(id),
  version_id text NOT NULL REFERENCES ${schema}."WorkflowVersion"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ingest_event_id, workflow_id, version_id)
);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowLease" (
  id text PRIMARY KEY,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  worker_id text NOT NULL,
  locked_until timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowTimer" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES ${schema}."WorkflowRun"(id),
  node_id text NOT NULL,
  resume_at timestamptz NOT NULL,
  status text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ${schema}."WorkflowTimer"
  ADD COLUMN IF NOT EXISTS payload jsonb;

CREATE INDEX IF NOT EXISTS "WorkflowTimer_status_resume_idx"
  ON ${schema}."WorkflowTimer"(status, resume_at);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowApproval" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES ${schema}."WorkflowRun"(id),
  node_id text NOT NULL,
  approval_name text NOT NULL,
  status text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  decision jsonb,
  reason text,
  assignees jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz,
  payload jsonb
);

ALTER TABLE ${schema}."WorkflowApproval"
  ADD COLUMN IF NOT EXISTS payload jsonb;

CREATE INDEX IF NOT EXISTS "WorkflowApproval_status_requested_idx"
  ON ${schema}."WorkflowApproval"(status, requested_at);

CREATE INDEX IF NOT EXISTS "WorkflowApproval_pending_run_node_requested_idx"
  ON ${schema}."WorkflowApproval"(run_id, node_id, requested_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS "WorkflowApproval_ready_expires_idx"
  ON ${schema}."WorkflowApproval"(expires_at)
  WHERE status = 'pending' AND expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowOutbox" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES ${schema}."WorkflowRun"(id),
  node_id text NOT NULL,
  idempotency_key text,
  destination text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  available_at timestamptz,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);

CREATE INDEX IF NOT EXISTS "WorkflowOutbox_status_created_idx"
  ON ${schema}."WorkflowOutbox"(status, available_at, created_at);

CREATE INDEX IF NOT EXISTS "WorkflowOutbox_pending_available_idx"
  ON ${schema}."WorkflowOutbox" (
    (coalesce(available_at, created_at)),
    created_at,
    id
  )
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowOutbox_destination_idempotency_unique"
  ON ${schema}."WorkflowOutbox"(destination, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowDeadLetter" (
  id text PRIMARY KEY,
  kind text NOT NULL,
  resource_id text NOT NULL,
  reason text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowConnectorAccount" (
  id text PRIMARY KEY,
  connector text NOT NULL,
  label text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowConnectorCursor" (
  id text PRIMARY KEY,
  connector text NOT NULL,
  cursor_key text NOT NULL,
  cursor_value text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector, cursor_key)
);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowCanvasLayout" (
  id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES ${schema}."WorkflowDefinition"(id),
  version_id text NOT NULL REFERENCES ${schema}."WorkflowVersion"(id),
  layout jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${schema}."WorkflowArtifact" (
  id text PRIMARY KEY,
  run_id text REFERENCES ${schema}."WorkflowRun"(id),
  kind text NOT NULL,
  uri text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
}
