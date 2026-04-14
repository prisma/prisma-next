import {
  boolColumn,
  float8Column,
  int4Column,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { uuidv4 } from '@prisma-next/ids';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const WorkflowRun = model('WorkflowRun', {
  fields: {
    id: field.generated(uuidv4()).id(),
    workflowId: field.column(textColumn).column('workflow_id'),
    status: field.column(textColumn),
    currentStepId: field.column(textColumn).optional().column('current_step_id'),
    waitingSignalId: field.column(textColumn).optional().column('waiting_signal_id'),
    computeServiceId: field.column(textColumn).optional().column('compute_service_id'),
    computeServiceEndpoint: field.column(textColumn).optional().column('compute_service_endpoint'),
    version: field.column(int4Column),
    createdAt: field.column(timestamptzColumn).defaultSql('now()').column('created_at'),
    updatedAt: field.column(timestamptzColumn).defaultSql('now()').column('updated_at'),
  },
}).sql({ table: 'pn_workflow_runs' });

const WorkflowStateField = model('WorkflowStateField', {
  fields: {
    id: field.column(int4Column).defaultSql('autoincrement()').id(),
    runId: field.column(textColumn).column('run_id'),
    fieldName: field.column(textColumn).column('field_name'),
    fieldKind: field.column(textColumn).column('field_kind'),
    stringValue: field.column(textColumn).optional().column('string_value'),
    numberValue: field.column(float8Column).optional().column('number_value'),
    booleanValue: field.column(boolColumn).optional().column('boolean_value'),
    updatedAt: field.column(timestamptzColumn).defaultSql('now()').column('updated_at'),
  },
}).sql({ table: 'pn_workflow_state_fields' });

const WorkflowStepRun = model('WorkflowStepRun', {
  fields: {
    id: field.column(int4Column).defaultSql('autoincrement()').id(),
    runId: field.column(textColumn).column('run_id'),
    stepId: field.column(textColumn).column('step_id'),
    attempt: field.column(int4Column),
    status: field.column(textColumn),
    errorMessage: field.column(textColumn).optional().column('error_message'),
    startedAt: field.column(timestamptzColumn).column('started_at'),
    finishedAt: field.column(timestamptzColumn).optional().column('finished_at'),
  },
}).sql({ table: 'pn_workflow_step_runs' });

const WorkflowEvent = model('WorkflowEvent', {
  fields: {
    id: field.column(int4Column).defaultSql('autoincrement()').id(),
    eventType: field.column(textColumn).column('event_type'),
    runId: field.column(textColumn).column('run_id'),
    stepId: field.column(textColumn).optional().column('step_id'),
    attempt: field.column(int4Column).optional(),
    signalId: field.column(textColumn).optional().column('signal_id'),
    message: field.column(textColumn).optional(),
    createdAt: field.column(timestamptzColumn).defaultSql('now()').column('created_at'),
  },
}).sql({ table: 'pn_workflow_events' });

export const workflowsContract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  capabilities: {
    postgres: {
      returning: true,
      'defaults.autoincrement': true,
      'defaults.now': true,
    },
  },
  models: {
    WorkflowRun,
    WorkflowStateField,
    WorkflowStepRun,
    WorkflowEvent,
  },
});
