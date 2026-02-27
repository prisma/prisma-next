import { ensureDatabaseExists } from './lib/db';
import { getScenarioUrl } from './lib/env';

const totalScenarios = 9;

async function main() {
  for (let scenario = 1; scenario <= totalScenarios; scenario += 1) {
    const url = getScenarioUrl(scenario);
    try {
      await ensureDatabaseExists(url);
      console.log(`✔ scenario_${scenario} ready`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✖ scenario_${scenario} failed: ${message}`);
    }
  }
}

await main();
