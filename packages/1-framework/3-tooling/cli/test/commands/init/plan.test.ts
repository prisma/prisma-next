import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyInitPlan, type InitPlan, planInit } from '../../../src/commands/init/plan';
import { defaultSchemaPath } from '../../../src/commands/init/templates/code-templates';
import { CliStructuredError } from '../../../src/utils/cli-errors';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'prisma-next-plan-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function expectStructuredError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(CliStructuredError.is(caught)).toBe(true);
  expect((caught as CliStructuredError).code).toBe(code);
}

function planPaths(plan: InitPlan): readonly string[] {
  return plan.files.map((file) => file.path);
}

describe('planInit', () => {
  it('returns the full scaffold plan without touching disk', async () => {
    const plan = await planInit(tmpDir, { target: 'postgres', authoring: 'psl' });

    const schemaPath = defaultSchemaPath('psl');
    expect(plan.target).toBe('postgres');
    expect(plan.authoring).toBe('psl');
    expect(plan.schemaPath).toBe(schemaPath);
    const paths = planPaths(plan);
    expect(paths).toContain(schemaPath);
    expect(paths).toContain('prisma-next.config.ts');
    expect(paths).toContain(join(dirname(schemaPath), 'db.ts'));
    expect(paths).toContain('prisma-next.md');
    expect(paths).toContain('.env.example');
    expect(paths).toContain('tsconfig.json');
    expect(paths).toContain('package.json');
    expect(plan.deletions).toEqual([]);

    expect(readdirSync(tmpDir)).toEqual([]);
  });

  it('resolves target aliases and reports the public spelling', async () => {
    const postgresql = await planInit(tmpDir, { target: 'postgresql', authoring: 'psl' });
    expect(postgresql.target).toBe('postgres');

    const mongo = await planInit(tmpDir, { target: 'mongo', authoring: 'psl' });
    expect(mongo.target).toBe('mongodb');
  });

  it('rejects an unknown target with the invalid-flag error', async () => {
    await expectStructuredError(
      planInit(tmpDir, { target: 'sqlite' as never, authoring: 'psl' }),
      '5004',
    );
  });

  it('rejects an authoring / schema-path extension mismatch', async () => {
    await expectStructuredError(
      planInit(tmpDir, { target: 'postgres', authoring: 'psl', schemaPath: 'contract.ts' }),
      '5014',
    );
  });

  it('requires force to re-plan an already-initialized project', async () => {
    writeFileSync(join(tmpDir, 'prisma-next.config.ts'), 'export default {};\n');
    await expectStructuredError(planInit(tmpDir, { target: 'postgres', authoring: 'psl' }), '5002');
  });

  it('queues stale contract artefacts for deletion on a forced re-plan', async () => {
    const schemaPath = defaultSchemaPath('psl');
    const schemaDir = dirname(schemaPath);
    writeFileSync(join(tmpDir, 'prisma-next.config.ts'), 'export default {};\n');
    mkdirSync(join(tmpDir, schemaDir), { recursive: true });
    writeFileSync(join(tmpDir, schemaDir, 'contract.json'), '{}');

    const plan = await planInit(tmpDir, { target: 'postgres', authoring: 'psl', force: true });
    expect(plan.deletions).toContain(join(schemaDir, 'contract.json'));
    expect(existsSync(join(tmpDir, schemaDir, 'contract.json'))).toBe(true);
  });

  it('maps a malformed package.json to the structured manifest error', async () => {
    writeFileSync(join(tmpDir, 'package.json'), 'not json');
    await expectStructuredError(planInit(tmpDir, { target: 'postgres', authoring: 'psl' }), '5010');
  });

  it('maps an unparseable tsconfig.json to the structured tsconfig error', async () => {
    writeFileSync(join(tmpDir, 'tsconfig.json'), '{ nope');
    await expectStructuredError(planInit(tmpDir, { target: 'postgres', authoring: 'psl' }), '5011');
  });

  it('merges an existing tsconfig instead of replacing it', async () => {
    writeFileSync(join(tmpDir, 'tsconfig.json'), '{ "compilerOptions": {} }\n');
    const plan = await planInit(tmpDir, { target: 'postgres', authoring: 'psl' });
    const tsconfig = plan.files.find((file) => file.path === 'tsconfig.json');
    expect(tsconfig?.logMessage).toBeDefined();
  });

  it('plans a .env write only on explicit opt-in and never over an existing .env', async () => {
    const withoutFlag = await planInit(tmpDir, { target: 'postgres', authoring: 'psl' });
    expect(planPaths(withoutFlag)).not.toContain('.env');

    const optedIn = await planInit(tmpDir, {
      target: 'postgres',
      authoring: 'psl',
      writeEnv: true,
    });
    expect(planPaths(optedIn)).toContain('.env');

    writeFileSync(join(tmpDir, '.env'), 'DATABASE_URL=secret\n');
    const existing = await planInit(tmpDir, {
      target: 'postgres',
      authoring: 'psl',
      writeEnv: true,
    });
    expect(planPaths(existing)).not.toContain('.env');
    expect(existing.warnings.some((warning) => warning.includes('.env already exists'))).toBe(true);
  });

  it('threads an explicit package manager into the generated docs', async () => {
    const plan = await planInit(tmpDir, {
      target: 'postgres',
      authoring: 'psl',
      packageManager: 'bun',
    });
    const quickReference = plan.files.find((file) => file.path === 'prisma-next.md');
    expect(quickReference?.content).toContain('bun prisma-next');
  });
});

describe('applyInitPlan', () => {
  it('writes exactly the planned files and reports them in order', async () => {
    const plan = await planInit(tmpDir, { target: 'postgres', authoring: 'psl' });
    const result = applyInitPlan(tmpDir, plan);

    expect(result.filesWritten).toEqual(planPaths(plan));
    expect(result.filesDeleted).toEqual([]);
    for (const file of plan.files) {
      expect(readFileSync(join(tmpDir, file.path), 'utf-8')).toBe(file.content);
    }
  });

  it('performs planned deletions and tolerates already-missing files', async () => {
    const schemaPath = defaultSchemaPath('psl');
    const schemaDir = dirname(schemaPath);
    writeFileSync(join(tmpDir, 'prisma-next.config.ts'), 'export default {};\n');
    mkdirSync(join(tmpDir, schemaDir), { recursive: true });
    writeFileSync(join(tmpDir, schemaDir, 'contract.json'), '{}');
    writeFileSync(join(tmpDir, schemaDir, 'contract.d.ts'), 'export {};\n');

    const plan = await planInit(tmpDir, { target: 'postgres', authoring: 'psl', force: true });
    rmSync(join(tmpDir, schemaDir, 'contract.d.ts'));
    const result = applyInitPlan(tmpDir, plan);

    expect(existsSync(join(tmpDir, schemaDir, 'contract.json'))).toBe(false);
    expect(result.filesDeleted).toEqual([join(schemaDir, 'contract.json')]);
  });

  it('invokes the write hook per file so callers can render progress', async () => {
    const plan = await planInit(tmpDir, { target: 'postgres', authoring: 'psl' });
    const seen: string[] = [];
    applyInitPlan(tmpDir, plan, { onFileWritten: (file) => seen.push(file.path) });
    expect(seen).toEqual(planPaths(plan));
  });
});
