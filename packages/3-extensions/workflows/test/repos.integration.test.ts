import { describe, it } from 'vitest';

// Integration tests for persistence repositories.
// These require a live Postgres instance.
// Run with: DATABASE_URL=<url> pnpm test

describe('repos — insertRun', () => {
  it.todo('inserts a run row and returns the generated id');
  it.todo('sets status to queued and version to 0');
});

describe('repos — loadRun', () => {
  it.todo('returns the run row for an existing id');
  it.todo('returns null for an unknown id');
});

describe('repos — updateRunStatus', () => {
  it.todo('transitions status from queued to running');
  it.todo('sets waitingSignalId when status is waiting_for_signal');
  it.todo('clears waitingSignalId when status transitions away');
});

describe('repos — updateRunCompute', () => {
  it.todo('stores compute service id and endpoint on the run row');
});

describe('repos — replaceStateFields + loadStateFields', () => {
  it.todo('persists all fields and reads them back via hydrateState');
  it.todo('overwrites existing fields on a second write');
  it.todo('handles empty state (removes all existing fields)');
});

describe('repos — insertStepRun + markStepCompleted', () => {
  it.todo('inserts a step run row and returns its id');
  it.todo('marks the step run as completed with finishedAt');
});

describe('repos — markStepFailed', () => {
  it.todo('marks the step run as failed and stores the error message');
});

describe('repos — loadCompletedStepIds', () => {
  it.todo('returns a Set of step ids that have status completed');
  it.todo('excludes failed step ids');
  it.todo('returns an empty set when no steps are completed');
});

describe('repos — appendEvent', () => {
  it.todo('inserts an event row with the correct fields');
});
