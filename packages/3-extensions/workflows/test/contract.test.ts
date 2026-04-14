import { describe, expect, it } from 'vitest';
import { workflowsContract } from '../src/persistence/contract';

describe('workflowsContract', () => {
  it('has exactly four models', () => {
    expect(Object.keys(workflowsContract.models)).toEqual([
      'WorkflowRun',
      'WorkflowStateField',
      'WorkflowStepRun',
      'WorkflowEvent',
    ]);
  });

  describe('table names', () => {
    it('maps WorkflowRun to pn_workflow_runs', () => {
      expect(workflowsContract.models.WorkflowRun?.storage?.table).toBe('pn_workflow_runs');
    });

    it('maps WorkflowStateField to pn_workflow_state_fields', () => {
      expect(workflowsContract.models.WorkflowStateField?.storage?.table).toBe(
        'pn_workflow_state_fields',
      );
    });

    it('maps WorkflowStepRun to pn_workflow_step_runs', () => {
      expect(workflowsContract.models.WorkflowStepRun?.storage?.table).toBe(
        'pn_workflow_step_runs',
      );
    });

    it('maps WorkflowEvent to pn_workflow_events', () => {
      expect(workflowsContract.models.WorkflowEvent?.storage?.table).toBe('pn_workflow_events');
    });
  });

  describe('WorkflowRun', () => {
    const storageFields = workflowsContract.models.WorkflowRun?.storage?.fields;
    const fields = workflowsContract.models.WorkflowRun?.fields;

    it('maps workflowId to workflow_id', () => {
      expect(storageFields?.workflowId?.column).toBe('workflow_id');
    });

    it('maps currentStepId to current_step_id', () => {
      expect(storageFields?.currentStepId?.column).toBe('current_step_id');
    });

    it('maps waitingSignalId to waiting_signal_id', () => {
      expect(storageFields?.waitingSignalId?.column).toBe('waiting_signal_id');
    });

    it('maps computeServiceId to compute_service_id', () => {
      expect(storageFields?.computeServiceId?.column).toBe('compute_service_id');
    });

    it('maps computeServiceEndpoint to compute_service_endpoint', () => {
      expect(storageFields?.computeServiceEndpoint?.column).toBe('compute_service_endpoint');
    });

    it('marks currentStepId as nullable', () => {
      expect(fields?.currentStepId?.nullable).toBe(true);
    });

    it('marks status as non-nullable', () => {
      expect(fields?.status?.nullable).toBe(false);
    });
  });

  describe('WorkflowStateField', () => {
    const storageFields = workflowsContract.models.WorkflowStateField?.storage?.fields;
    const fields = workflowsContract.models.WorkflowStateField?.fields;

    it('maps runId to run_id', () => {
      expect(storageFields?.runId?.column).toBe('run_id');
    });

    it('maps fieldName to field_name', () => {
      expect(storageFields?.fieldName?.column).toBe('field_name');
    });

    it('maps fieldKind to field_kind', () => {
      expect(storageFields?.fieldKind?.column).toBe('field_kind');
    });

    it('marks stringValue as nullable', () => {
      expect(fields?.stringValue?.nullable).toBe(true);
    });

    it('marks numberValue as nullable', () => {
      expect(fields?.numberValue?.nullable).toBe(true);
    });

    it('marks booleanValue as nullable', () => {
      expect(fields?.booleanValue?.nullable).toBe(true);
    });
  });

  describe('WorkflowStepRun', () => {
    const storageFields = workflowsContract.models.WorkflowStepRun?.storage?.fields;
    const fields = workflowsContract.models.WorkflowStepRun?.fields;

    it('maps runId to run_id', () => {
      expect(storageFields?.runId?.column).toBe('run_id');
    });

    it('maps stepId to step_id', () => {
      expect(storageFields?.stepId?.column).toBe('step_id');
    });

    it('maps errorMessage to error_message', () => {
      expect(storageFields?.errorMessage?.column).toBe('error_message');
    });

    it('marks errorMessage as nullable', () => {
      expect(fields?.errorMessage?.nullable).toBe(true);
    });

    it('marks finishedAt as nullable', () => {
      expect(fields?.finishedAt?.nullable).toBe(true);
    });
  });

  describe('WorkflowEvent', () => {
    const storageFields = workflowsContract.models.WorkflowEvent?.storage?.fields;
    const fields = workflowsContract.models.WorkflowEvent?.fields;

    it('maps eventType to event_type', () => {
      expect(storageFields?.eventType?.column).toBe('event_type');
    });

    it('maps runId to run_id', () => {
      expect(storageFields?.runId?.column).toBe('run_id');
    });

    it('maps stepId to step_id', () => {
      expect(storageFields?.stepId?.column).toBe('step_id');
    });

    it('marks stepId as nullable', () => {
      expect(fields?.stepId?.nullable).toBe(true);
    });

    it('marks signalId as nullable', () => {
      expect(fields?.signalId?.nullable).toBe(true);
    });
  });
});
