import type { AppConfig } from '@boomerbuddy/config';
import { JobExecutionError, type JobHandler } from '@boomerbuddy/platform';

import type { LocalMessagingDispatchResult } from '../../../packages/persistence/src/messaging';

export const messagingLocalSimulationJobType = 'messaging.local-simulate';

export interface ProviderFreeMessagingWorkerComposition {
  readonly handlers: Readonly<Record<string, JobHandler>>;
  readonly installed: boolean;
}

export interface LocalMessagingDispatchPort {
  dispatchLocalSimulation(input: {
    readonly intentId: string;
    readonly jobId: string;
    readonly now: Date;
  }): Promise<LocalMessagingDispatchResult>;
}

function intentIdFromJob(job: Parameters<JobHandler>[0]['job']): string {
  const keys = Object.keys(job.payload).sort();
  if (
    job.type !== messagingLocalSimulationJobType ||
    job.version !== 1 ||
    job.classification !== 'internal' ||
    keys.length !== 2 ||
    keys[0] !== 'intentId' ||
    keys[1] !== 'localOnly' ||
    typeof job.payload.intentId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,199}$/u.test(job.payload.intentId) ||
    job.payload.localOnly !== true
  ) {
    throw new JobExecutionError('messaging_local_payload_invalid', false);
  }
  return job.payload.intentId;
}

export function createLocalMessagingSimulationHandler(input: {
  readonly messaging: LocalMessagingDispatchPort;
  readonly clock?: () => Date;
}): JobHandler {
  const clock = input.clock ?? (() => new Date());
  return async ({ heartbeat, job }) => {
    const intentId = intentIdFromJob(job);
    await input.messaging.dispatchLocalSimulation({
      intentId,
      jobId: job.id,
      now: clock(),
    });
    await heartbeat();
  };
}

export function composeProviderFreeMessagingWorker(input: {
  readonly environment: AppConfig['environment'];
  readonly messaging: LocalMessagingDispatchPort;
  readonly clock?: () => Date;
}): ProviderFreeMessagingWorkerComposition {
  if (input.environment === 'production') return { handlers: {}, installed: false };
  return {
    handlers: {
      [messagingLocalSimulationJobType]: createLocalMessagingSimulationHandler({
        messaging: input.messaging,
        ...(input.clock === undefined ? {} : { clock: input.clock }),
      }),
    },
    installed: true,
  };
}
