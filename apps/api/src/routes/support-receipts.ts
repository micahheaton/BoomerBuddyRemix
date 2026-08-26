import { assertAuthorized } from '@boomerbuddy/authorization';
import {
  createSupportReceiptRequestSchema,
  hqSupportReceiptListResponseSchema,
  hqSupportReceiptTransitionResponseSchema,
  supportReceiptCreateOperationKeySchema,
  supportReceiptListResponseSchema,
  supportReceiptMutationResponseSchema,
  supportReceiptTransitionOperationKeySchema,
  supportReceiptWithdrawalOperationKeySchema,
  transitionSupportReceiptRequestSchema,
  withdrawSupportReceiptRequestSchema,
} from '@boomerbuddy/contracts';
import type { SupportReceiptRecord } from '@boomerbuddy/persistence';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { assertMutationOrigin, authenticate, correlationId, selectedHousehold } from '../auth';
import type { ApiContext } from '../context';

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict();

function noStore(reply: FastifyReply): void {
  void reply.header('Cache-Control', 'private, no-store, max-age=0');
  void reply.header('Pragma', 'no-cache');
  void reply.header('Expires', '0');
}

function customerRecord(record: SupportReceiptRecord) {
  return {
    receiptCode: record.receiptCode,
    category: record.category,
    impact: record.impact,
    state: record.state,
    ...(record.resolutionCode === undefined ? {} : { resolutionCode: record.resolutionCode }),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function hqRecord(record: SupportReceiptRecord) {
  return { householdId: record.householdId, ...customerRecord(record) };
}

export function registerSupportReceiptRoutes(
  app: FastifyInstance,
  context: ApiContext,
  options: {
    readonly customerAccessEnabled?: boolean;
    readonly intakeEnabled?: boolean;
    readonly hqQueueEnabled?: boolean;
  } = {},
): void {
  if (options.customerAccessEnabled === true) {
    app.get('/v1/support-receipts', async (request, reply) => {
      noStore(reply);
      const query = listQuerySchema.parse(request.query);
      const auth = await authenticate(
        request,
        context.repositories.sessions,
        context.config,
        ['customer', 'mobile'],
        context.now(),
      );
      const household = selectedHousehold(auth, request);
      assertAuthorized({
        principal: auth.principal,
        action: 'support_receipt:list',
        resource: {
          kind: 'support_receipt_collection',
          householdId: household.householdId,
          ownerPersonId: auth.principal.personId,
        },
      });
      const result = await context.repositories.supportReceipts.listForCustomer({
        actorPersonId: auth.principal.personId,
        householdId: household.householdId,
        limit: query.limit,
        offset: query.offset,
      });
      return supportReceiptListResponseSchema.parse({
        receipts: result.receipts.map(customerRecord),
        truncated: result.truncated,
        nextOffset: result.nextOffset,
        contentIncluded: false,
        outboundMessage: 'not_sent',
        providerAction: 'none',
      });
    });

    app.post('/v1/support-receipts/withdrawals', async (request, reply) => {
      noStore(reply);
      const auth = await authenticate(
        request,
        context.repositories.sessions,
        context.config,
        ['customer', 'mobile'],
        context.now(),
      );
      assertMutationOrigin(request, context.config, auth);
      const household = selectedHousehold(auth, request);
      const body = withdrawSupportReceiptRequestSchema.parse(request.body);
      const operationKey = supportReceiptWithdrawalOperationKeySchema.parse(
        request.headers['idempotency-key'],
      );
      assertAuthorized({
        principal: auth.principal,
        action: 'support_receipt:withdraw',
        resource: {
          kind: 'support_receipt',
          householdId: household.householdId,
          openedByPersonId: auth.principal.personId,
        },
      });
      const result = await context.repositories.supportReceipts.withdraw({
        actorPersonId: auth.principal.personId,
        audience: auth.audience === 'mobile' ? 'mobile' : 'customer',
        householdId: household.householdId,
        receiptCode: body.receiptCode,
        operationKey,
        correlationId: correlationId(request),
      });
      return supportReceiptMutationResponseSchema.parse({
        receipt: customerRecord(result.receipt),
        reused: result.reused,
        contentIncluded: false,
        outboundMessage: 'not_sent',
        providerAction: 'none',
      });
    });
  }

  if (options.intakeEnabled === true) {
    app.post('/v1/support-receipts', async (request, reply) => {
      noStore(reply);
      const auth = await authenticate(
        request,
        context.repositories.sessions,
        context.config,
        ['customer', 'mobile'],
        context.now(),
      );
      assertMutationOrigin(request, context.config, auth);
      const household = selectedHousehold(auth, request);
      const body = createSupportReceiptRequestSchema.parse(request.body);
      const operationKey = supportReceiptCreateOperationKeySchema.parse(
        request.headers['idempotency-key'],
      );
      assertAuthorized({
        principal: auth.principal,
        action: 'support_receipt:create',
        resource: {
          kind: 'support_receipt_collection',
          householdId: household.householdId,
          ownerPersonId: auth.principal.personId,
        },
      });
      const result = await context.repositories.supportReceipts.create({
        actorPersonId: auth.principal.personId,
        audience: auth.audience === 'mobile' ? 'mobile' : 'customer',
        householdId: household.householdId,
        category: body.category,
        impact: body.impact,
        operationKey,
        correlationId: correlationId(request),
      });
      return reply.code(201).send(
        supportReceiptMutationResponseSchema.parse({
          receipt: customerRecord(result.receipt),
          reused: result.reused,
          contentIncluded: false,
          outboundMessage: 'not_sent',
          providerAction: 'none',
        }),
      );
    });
  }

  if (options.hqQueueEnabled === true) {
    app.get('/v1/hq/support-receipts', async (request, reply) => {
      noStore(reply);
      const query = listQuerySchema.parse(request.query);
      const auth = await authenticate(
        request,
        context.repositories.sessions,
        context.config,
        ['hq'],
        context.now(),
      );
      assertAuthorized({
        principal: auth.principal,
        action: 'hq:support_receipts:read',
        resource: { kind: 'hq' },
      });
      const result = await context.repositories.supportReceipts.listForHq({
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
        limit: query.limit,
        offset: query.offset,
      });
      return hqSupportReceiptListResponseSchema.parse({
        projection: 'content_free_support_receipts',
        receipts: result.receipts.map(hqRecord),
        truncated: result.truncated,
        nextOffset: result.nextOffset,
        contentIncluded: false,
        outboundMessage: 'not_sent',
        providerAction: 'none',
      });
    });

    app.post('/v1/hq/support-receipts/transitions', async (request, reply) => {
      noStore(reply);
      const auth = await authenticate(
        request,
        context.repositories.sessions,
        context.config,
        ['hq'],
        context.now(),
      );
      assertMutationOrigin(request, context.config, auth);
      assertAuthorized({
        principal: auth.principal,
        action: 'hq:support_receipts:manage',
        resource: { kind: 'hq' },
      });
      const body = transitionSupportReceiptRequestSchema.parse(request.body);
      const operationKey = supportReceiptTransitionOperationKeySchema.parse(
        request.headers['idempotency-key'],
      );
      const result = await context.repositories.supportReceipts.transition({
        actorPersonId: auth.principal.personId,
        receiptCode: body.receiptCode,
        action: body.action,
        ...(body.resolutionCode === undefined ? {} : { resolutionCode: body.resolutionCode }),
        operationKey,
        correlationId: correlationId(request),
      });
      return hqSupportReceiptTransitionResponseSchema.parse({
        receipt: hqRecord(result.receipt),
        reused: result.reused,
        contentIncluded: false,
        outboundMessage: 'not_sent',
        providerAction: 'none',
      });
    });
  }
}
