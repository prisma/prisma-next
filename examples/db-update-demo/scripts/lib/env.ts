import 'dotenv/config';

export function getScenarioUrl(scenario: number): string {
  const key = `SCENARIO_${scenario}_DATABASE_URL`;
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing ${key} in .env`);
  }
  return value;
}

export function parseScenarioArg(value: string | undefined): number {
  if (!value) {
    throw new Error('Scenario number is required.');
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9) {
    throw new Error(`Scenario must be an integer from 1 to 9. Received: ${value}`);
  }
  return parsed;
}

export function getEnvNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
