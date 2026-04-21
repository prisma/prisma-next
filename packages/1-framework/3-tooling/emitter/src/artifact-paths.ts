const JSON_EXTENSION = '.json';

export interface EmittedArtifactPaths {
  readonly jsonPath: string;
  readonly dtsPath: string;
}

export function getEmittedArtifactPaths(outputJsonPath: string): EmittedArtifactPaths {
  if (!outputJsonPath.endsWith(JSON_EXTENSION)) {
    throw new Error('Contract output path must end with .json');
  }

  return {
    jsonPath: outputJsonPath,
    dtsPath: `${outputJsonPath.slice(0, -JSON_EXTENSION.length)}.d.ts`,
  };
}
