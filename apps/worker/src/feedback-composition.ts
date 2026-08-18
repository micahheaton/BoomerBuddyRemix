import type { AppConfig } from '@boomerbuddy/config';
import type { DurableJobRepository } from '@boomerbuddy/persistence';
import type { JobHandler } from '@boomerbuddy/platform';
import {
  createFeedbackRetentionHandler,
  enqueueFeedbackRetention,
  feedbackRetentionJobType,
} from './feedback-retention';

export interface FeedbackWorkerComposition {
  readonly handlers: Readonly<Record<string, JobHandler>>;
}

export async function composeFeedbackWorker(input: {
  readonly environment: AppConfig['environment'];
  readonly feedback: {
    purgeDue(value: { readonly now: Date; readonly limit: number }): Promise<number>;
  };
  readonly jobs: Pick<DurableJobRepository, 'enqueue'>;
  readonly now: Date;
  readonly clock?: () => Date;
}): Promise<FeedbackWorkerComposition> {
  await enqueueFeedbackRetention({ jobs: input.jobs, now: input.now });
  return {
    handlers: {
      [feedbackRetentionJobType]: createFeedbackRetentionHandler({
        feedback: input.feedback,
        jobs: input.jobs,
        ...(input.clock === undefined ? {} : { clock: input.clock }),
      }),
    },
  };
}
