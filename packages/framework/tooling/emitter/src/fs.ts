import { readFileSync } from 'node:fs';

export function readJsonFile<T = unknown>(filePath: string): T {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readTextFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
