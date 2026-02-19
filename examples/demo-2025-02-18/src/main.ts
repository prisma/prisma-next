import 'dotenv/config';
import { arktypeDb } from './arktype-json/db';
import { createArktypeProfile, listArktypeProfiles } from './arktype-json/queries';
import { idsDb } from './ids-generators/db';
import {
  createNanoidRecord,
  createNanoidRecordWithOverride,
  createUlidRecord,
} from './ids-generators/queries';
import { zodDb } from './zod-discriminated-union/db';
import { createZodEvent, listZodEvents } from './zod-discriminated-union/queries';

async function runArktypeScenario() {
  const runtime = arktypeDb.runtime();
  try {
    await createArktypeProfile(
      {
        label: 'first-profile',
        profile: { displayName: 'Ada', age: 37, newsletter: true },
      },
      runtime,
    );
    return await listArktypeProfiles(runtime);
  } finally {
    await runtime.close();
  }
}

async function runZodScenario() {
  const runtime = zodDb.runtime();
  try {
    await createZodEvent(
      {
        source: 'demo-runner',
        event: { _tag: 'user.created', userId: 'u_1', email: 'ada@example.com' },
      },
      runtime,
    );
    return await listZodEvents(runtime);
  } finally {
    await runtime.close();
  }
}

async function runIdsScenario() {
  const runtime = idsDb.runtime();
  try {
    const generated = await createNanoidRecord('generated-id', runtime);
    const overridden = await createNanoidRecordWithOverride('overridden-id', runtime);
    const ulidGenerated = await createUlidRecord('ulid-note', runtime);
    return { generated, overridden, ulidGenerated };
  } finally {
    await runtime.close();
  }
}

const arktypeRows = await runArktypeScenario();
const zodRows = await runZodScenario();
const idsRows = await runIdsScenario();

console.log(JSON.stringify({ arktypeRows, zodRows, idsRows }, null, 2));
