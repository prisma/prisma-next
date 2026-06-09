import type { OpFactoryCall } from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { renderOps } from '../../src/core/migrations/render-ops';

function makeCall(targetId: string, opId: string, factoryName = 'noop'): OpFactoryCall {
  return {
    factoryName,
    operationClass: 'additive',
    label: `${opId} op`,
    renderTypeScript: () => '',
    importRequirements: () => [],
    toOp: () => ({
      id: opId,
      label: `${opId} op`,
      operationClass: 'additive',
      target: { id: targetId },
      precheck: [],
      execute: [],
      postcheck: [],
    }),
  } as unknown as OpFactoryCall;
}

describe('renderOps', () => {
  it('passes through ops whose target.id is "postgres"', async () => {
    const result = await Promise.all(renderOps([makeCall('postgres', 'table.users.create')]));
    expect(result).toHaveLength(1);
    expect(result[0]?.target.id).toBe('postgres');
    expect(result[0]?.id).toBe('table.users.create');
  });

  it('throws when a call materialises an op for a different target', () => {
    expect(() => renderOps([makeCall('sqlite', 'table.users.create', 'createTable')])).toThrow(
      /expected postgres op.+target\.id="sqlite".+factoryName="createTable"/,
    );
  });
});
