export type WorkflowStateValue = string | number | boolean | null;
export type WorkflowState = Record<string, WorkflowStateValue>;

export type StateFieldKind = 'string' | 'number' | 'boolean' | 'null';

export interface StateFieldInput {
  readonly runId: string;
  readonly fieldName: string;
  readonly fieldKind: StateFieldKind;
  readonly stringValue: string | null;
  readonly numberValue: number | null;
  readonly booleanValue: boolean | null;
}

export interface StateFieldRow {
  readonly fieldName: string;
  readonly fieldKind: string;
  readonly stringValue: string | null;
  readonly numberValue: number | null;
  readonly booleanValue: boolean | null;
}

export function flattenState(runId: string, state: WorkflowState): StateFieldInput[] {
  return Object.entries(state).map(([fieldName, value]) => {
    if (value === null) {
      return {
        runId,
        fieldName,
        fieldKind: 'null',
        stringValue: null,
        numberValue: null,
        booleanValue: null,
      };
    }
    if (typeof value === 'string') {
      return {
        runId,
        fieldName,
        fieldKind: 'string',
        stringValue: value,
        numberValue: null,
        booleanValue: null,
      };
    }
    if (typeof value === 'number') {
      return {
        runId,
        fieldName,
        fieldKind: 'number',
        stringValue: null,
        numberValue: value,
        booleanValue: null,
      };
    }
    return {
      runId,
      fieldName,
      fieldKind: 'boolean',
      stringValue: null,
      numberValue: null,
      booleanValue: value,
    };
  });
}

export function hydrateState(rows: StateFieldRow[]): WorkflowState {
  const state: WorkflowState = {};
  for (const row of rows) {
    state[row.fieldName] = decodeFieldValue(row);
  }
  return state;
}

function decodeFieldValue(row: StateFieldRow): WorkflowStateValue {
  switch (row.fieldKind) {
    case 'string':
      return row.stringValue;
    case 'number':
      return row.numberValue;
    case 'boolean':
      return row.booleanValue;
    default:
      return null;
  }
}
