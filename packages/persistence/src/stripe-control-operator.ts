import { DomainError } from '@boomerbuddy/domain';

import type { SqlExecutor } from './database';

/** Require both the configured founder identity and a current internal HQ owner assignment. */
export async function assertStripeControlOperator(input: {
  readonly executor: SqlExecutor;
  readonly actorPersonId: string;
  readonly configuredFounderPersonId?: string;
}): Promise<void> {
  if (
    input.configuredFounderPersonId === undefined ||
    input.actorPersonId !== input.configuredFounderPersonId
  ) {
    throw new DomainError('not_authorized', 'Stripe controls require the configured founder');
  }
  const result = await input.executor.query<{ readonly authorized: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM employee_assignments employee
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.role = 'hq_owner'
         AND employee.status = 'active' AND organization.kind = 'internal'
     ) AS authorized`,
    [input.actorPersonId],
  );
  if (result.rows[0]?.authorized !== true) {
    throw new DomainError('not_authorized', 'Stripe controls require an active internal HQ owner');
  }
}
