CREATE SCHEMA IF NOT EXISTS "_prisma_workflows";

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowDefinition" (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowVersion" (
  id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowDefinition"(id),
  version integer NOT NULL,
  status text NOT NULL,
  source_hash text NOT NULL,
  compiled_graph jsonb NOT NULL,
  visual_graph jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, version)
);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowIngestEvent" (
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
  ON "_prisma_workflows"."WorkflowIngestEvent"(source, event_type, received_at);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowRun" (
  id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowDefinition"(id),
  version_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowVersion"(id),
  ingest_event_id text REFERENCES "_prisma_workflows"."WorkflowIngestEvent"(id),
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
  ON "_prisma_workflows"."WorkflowRun"(workflow_id, status, created_at);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowStepRun" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowRun"(id),
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

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowTimelineEvent" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowRun"(id),
  sequence integer NOT NULL,
  type text NOT NULL,
  node_id text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowStateSnapshot" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowRun"(id),
  sequence integer NOT NULL,
  node_id text,
  state jsonb NOT NULL,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowTriggerMatch" (
  id text PRIMARY KEY,
  ingest_event_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowIngestEvent"(id),
  workflow_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowDefinition"(id),
  version_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowVersion"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ingest_event_id, workflow_id, version_id)
);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowLease" (
  id text PRIMARY KEY,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  worker_id text NOT NULL,
  locked_until timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowTimer" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowRun"(id),
  node_id text NOT NULL,
  resume_at timestamptz NOT NULL,
  status text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "_prisma_workflows"."WorkflowTimer"
  ADD COLUMN IF NOT EXISTS payload jsonb;

CREATE INDEX IF NOT EXISTS "WorkflowTimer_status_resume_idx"
  ON "_prisma_workflows"."WorkflowTimer"(status, resume_at);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowApproval" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowRun"(id),
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

ALTER TABLE "_prisma_workflows"."WorkflowApproval"
  ADD COLUMN IF NOT EXISTS payload jsonb;

CREATE INDEX IF NOT EXISTS "WorkflowApproval_status_requested_idx"
  ON "_prisma_workflows"."WorkflowApproval"(status, requested_at);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowOutbox" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowRun"(id),
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
  ON "_prisma_workflows"."WorkflowOutbox"(status, available_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowOutbox_destination_idempotency_unique"
  ON "_prisma_workflows"."WorkflowOutbox"(destination, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowDeadLetter" (
  id text PRIMARY KEY,
  kind text NOT NULL,
  resource_id text NOT NULL,
  reason text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowConnectorAccount" (
  id text PRIMARY KEY,
  connector text NOT NULL,
  label text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowConnectorCursor" (
  id text PRIMARY KEY,
  connector text NOT NULL,
  cursor_key text NOT NULL,
  cursor_value text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector, cursor_key)
);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowCanvasLayout" (
  id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowDefinition"(id),
  version_id text NOT NULL REFERENCES "_prisma_workflows"."WorkflowVersion"(id),
  layout jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "_prisma_workflows"."WorkflowArtifact" (
  id text PRIMARY KEY,
  run_id text REFERENCES "_prisma_workflows"."WorkflowRun"(id),
  kind text NOT NULL,
  uri text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
