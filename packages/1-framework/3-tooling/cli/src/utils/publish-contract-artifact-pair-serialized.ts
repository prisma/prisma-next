import { publishContractArtifactPair } from './publish-contract-artifact-pair';

interface EmitOutputQueueState {
  nextGeneration: number;
  queue: Promise<void>;
}

const emitOutputQueues = new Map<string, EmitOutputQueueState>();

function getEmitOutputQueue(outputJsonPath: string): EmitOutputQueueState {
  const existing = emitOutputQueues.get(outputJsonPath);
  if (existing) {
    return existing;
  }

  const created: EmitOutputQueueState = {
    nextGeneration: 0,
    queue: Promise.resolve(),
  };
  emitOutputQueues.set(outputJsonPath, created);
  return created;
}

export function issueContractArtifactGeneration(outputJsonPath: string): number {
  const state = getEmitOutputQueue(outputJsonPath);
  state.nextGeneration += 1;
  return state.nextGeneration;
}

function isSuperseded(state: EmitOutputQueueState, generation: number): boolean {
  return generation < state.nextGeneration;
}

function toQueueTail<T>(promise: Promise<T>): Promise<void> {
  return promise.then(
    () => undefined,
    () => undefined,
  );
}

function queueEmitWrite<T>(
  outputJsonPath: string,
  action: (state: EmitOutputQueueState) => Promise<T>,
): Promise<T> {
  const state = getEmitOutputQueue(outputJsonPath);
  const run = state.queue.then(
    () => action(state),
    () => action(state),
  );
  state.queue = toQueueTail(run);
  return run;
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export async function publishContractArtifactPairSerialized({
  outputJsonPath,
  outputDtsPath,
  generation,
  signal,
  contractJson,
  contractDts,
}: {
  readonly outputJsonPath: string;
  readonly outputDtsPath: string;
  readonly generation: number;
  readonly signal?: AbortSignal;
  readonly contractJson: string;
  readonly contractDts: string;
}): Promise<'written' | 'superseded'> {
  return await queueEmitWrite(outputJsonPath, async (state) => {
    throwIfAborted(signal);

    if (isSuperseded(state, generation)) {
      return 'superseded';
    }

    const didPublish = await publishContractArtifactPair({
      outputJsonPath,
      outputDtsPath,
      contractJson,
      contractDts,
      publicationToken: String(generation),
      beforePublish: () => {
        throwIfAborted(signal);
        return !isSuperseded(state, generation);
      },
    });
    return didPublish ? 'written' : 'superseded';
  });
}
