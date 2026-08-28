-- Bind paid Family access to one exact runtime-aware evidence chain.
-- This migration intentionally does not mutate immutable catalogue rows.

ALTER TABLE commerce_stripe_preflight_records
  ADD CONSTRAINT commerce_stripe_preflight_id_environment_unique
  UNIQUE (id, environment);

ALTER TABLE commerce_stripe_session_operations
  ADD COLUMN preflight_record_id text,
  ADD CONSTRAINT commerce_stripe_production_operation_preflight_check
  CHECK (environment <> 'production' OR preflight_record_id IS NOT NULL),
  ADD CONSTRAINT commerce_stripe_operation_preflight_environment_fk
  FOREIGN KEY (preflight_record_id, environment)
  REFERENCES commerce_stripe_preflight_records(id, environment) ON DELETE RESTRICT;

CREATE FUNCTION commerce_hypothesis_subscription_backing_supports(
  target_household_id text,
  target_subscription_id text,
  target_runtime_environment text,
  effective_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF target_runtime_environment = 'local' THEN
    RETURN EXISTS (
      SELECT 1
      FROM commerce_subscriptions subscription
      WHERE subscription.household_id = target_household_id
        AND subscription.id = target_subscription_id
        AND (
          (
            subscription.source <> 'sponsor'
            AND EXISTS (
              SELECT 1
              FROM commerce_provider_subscription_records provider
              WHERE provider.household_id = subscription.household_id
                AND provider.subscription_id = subscription.id
                AND provider.environment IN ('local','test')
                AND provider.verified_at IS NOT NULL
            )
          )
          OR (
            subscription.source = 'sponsor'
            AND EXISTS (
              SELECT 1
              FROM entitlement_grants grant_record
              JOIN commerce_sponsorship_allocations allocation
                ON allocation.household_id = grant_record.household_id
               AND allocation.id = grant_record.sponsorship_id
              JOIN commerce_sponsorships sponsorship
                ON sponsorship.id = allocation.sponsorship_id
              JOIN organizations organization
                ON organization.id = sponsorship.organization_id
              WHERE grant_record.household_id = subscription.household_id
                AND grant_record.subscription_id = subscription.id
                AND organization.verification_state = 'local_fixture'
            )
          )
        )
    );
  END IF;

  IF target_runtime_environment IS DISTINCT FROM 'production' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM commerce_subscriptions subscription
    JOIN commerce_plan_versions plan
      ON plan.id = subscription.plan_version_id
    JOIN commerce_product_versions product
      ON product.id = plan.product_version_id
    JOIN commerce_provider_subscription_records provider
      ON provider.household_id = subscription.household_id
     AND provider.subscription_id = subscription.id
     AND provider.provider = 'stripe'
     AND provider.environment = 'production'
    JOIN commerce_provider_customers customer
      ON customer.provider = provider.provider
     AND customer.environment = provider.environment
     AND customer.provider_customer_id = provider.provider_customer_id
     AND customer.household_id = subscription.household_id
    JOIN commerce_stripe_checkout_completions completion
      ON completion.environment = provider.environment
     AND completion.household_id = subscription.household_id
     AND completion.subscription_id = subscription.id
     AND completion.provider_subscription_id = provider.external_subscription_id
     AND completion.provider_customer_id = provider.provider_customer_id
    JOIN commerce_checkout_intents intent
      ON intent.household_id = completion.household_id
     AND intent.id = completion.checkout_intent_id
     AND intent.subscription_id = subscription.id
    JOIN commerce_stripe_offer_contracts offer
      ON offer.offer_id = intent.offer_id
     AND offer.plan_version_id = intent.plan_version_id
    JOIN commerce_stripe_session_operations operation
      ON operation.household_id = intent.household_id
     AND operation.checkout_intent_id = intent.id
     AND operation.environment = intent.environment
     AND operation.action = 'checkout'
     AND operation.provider_session_id = completion.provider_session_id
    JOIN commerce_stripe_preflight_records preflight
      ON preflight.id = operation.preflight_record_id
     AND preflight.environment = operation.environment
    JOIN commerce_event_inbox checkout_event
      ON checkout_event.id = completion.source_inbox_id
    JOIN commerce_stripe_paid_invoice_evidence paid
      ON paid.environment = completion.environment
     AND paid.household_id = completion.household_id
     AND paid.subscription_id = completion.subscription_id
     AND paid.checkout_intent_id = completion.checkout_intent_id
     AND paid.provider_subscription_id = completion.provider_subscription_id
    JOIN commerce_stripe_invoice_authority_facts invoice_authority
      ON invoice_authority.provider_invoice_id = paid.provider_invoice_id
     AND invoice_authority.provider_subscription_item_id = paid.provider_subscription_item_id
    JOIN commerce_event_inbox invoice_event
      ON invoice_event.id = paid.source_inbox_id
    JOIN commerce_event_inbox current_event
      ON current_event.provider = provider.provider
     AND current_event.environment = provider.environment
     AND current_event.external_event_id = provider.last_external_event_id
    WHERE subscription.household_id = target_household_id
      AND subscription.id = target_subscription_id
      AND subscription.source = 'web'
      AND subscription.plan_version_id = 'family_v1'
      AND subscription.source_verified = true
      AND subscription.reconciliation_state = 'reconciled'
      AND subscription.current_period_starts_at <= effective_at
      AND subscription.current_period_ends_at > effective_at
      AND subscription.ended_at IS NULL
      AND plan.id = 'family_v1'
      AND plan.product_version_id = 'consumer_household_v1'
      AND plan.plan_key = 'family'
      AND plan.version = 1
      AND plan.state = 'hypothesis'
      AND plan.prices =
        '[{"interval":"month","amountMinor":1499,"currency":"USD","kind":"list"}]'::jsonb
      AND plan.available_from <= effective_at
      AND (plan.available_until IS NULL OR plan.available_until > effective_at)
      AND product.id = 'consumer_household_v1'
      AND product.product_key = 'consumer_household'
      AND product.version = 1
      AND product.available_from <= effective_at
      AND (product.available_until IS NULL OR product.available_until > effective_at)
      AND provider.verified_at IS NOT NULL
      AND provider.provider_customer_id IS NOT NULL
      AND provider.financial_restriction IS NULL
      AND provider.financial_restriction_event_id IS NULL
      AND provider.financial_restricted_at IS NULL
      AND provider.last_external_event_id IS NOT NULL
      AND provider.last_provider_event_created_at IS NOT NULL
      AND provider.last_provider_api_version IS NOT NULL
      AND provider.provider_version = preflight.api_version
      AND provider.last_provider_api_version = preflight.api_version
      AND NOT EXISTS (
        SELECT 1
        FROM commerce_provider_subscription_records competing_provider
        WHERE competing_provider.household_id = subscription.household_id
          AND competing_provider.subscription_id = subscription.id
          AND competing_provider.provider = 'stripe'
          AND competing_provider.environment = 'production'
          AND competing_provider.id <> provider.id
      )
      AND customer.verified_at IS NOT NULL
      AND intent.provider = 'stripe'
      AND intent.environment = 'production'
      AND intent.plan_version_id = 'family_v1'
      AND intent.billing_interval = 'month'
      AND intent.offer_id = 'founding_family_monthly_v1'
      AND intent.provider_price_id = invoice_authority.provider_price_id
      AND intent.state = 'session_created'
      AND intent.dispatch_state = 'session_recorded'
      AND intent.provider_session_id = completion.provider_session_id
      AND offer.offer_id = 'founding_family_monthly_v1'
      AND offer.billing_interval = 'month'
      AND offer.currency = 'usd'
      AND offer.unit_amount_minor = 1499
      AND offer.quantity = 1
      AND offer.promotions_enabled = false
      AND offer.automatic_tax_enabled = false
      AND offer.adaptive_pricing_enabled = false
      AND operation.state = 'succeeded'
      AND operation.canonical_subscription_id = subscription.id
      AND operation.provider_price_id = intent.provider_price_id
      AND operation.preflight_record_id IS NOT NULL
      AND operation.returned_expires_at = completion.provider_expires_at
      AND preflight.livemode = true
      AND preflight.offer_id = offer.offer_id
      AND preflight.provider_product_id = invoice_authority.provider_product_id
      AND preflight.provider_price_id = invoice_authority.provider_price_id
      AND preflight.currency = offer.currency
      AND preflight.unit_amount_minor = offer.unit_amount_minor
      AND preflight.quantity = offer.quantity
      AND preflight.product_active = true
      AND preflight.price_active = true
      AND preflight.recurring_interval = offer.billing_interval
      AND preflight.portal_cancel_only = true
      AND preflight.portal_mutation_controls_exact = true
      AND preflight.portal_cancellation_mode = 'at_period_end'
      AND preflight.portal_proration_behavior = 'none'
      AND preflight.portal_subscription_update_defaults_empty = true
      AND preflight.portal_payment_method_update_enabled = true
      AND preflight.portal_invoice_history_enabled = true
      AND preflight.promotions_enabled = false
      AND preflight.automatic_tax_enabled = false
      AND preflight.adaptive_pricing_enabled = false
      AND preflight.evidence_level = 'live_production'
      AND preflight.transport_kind = 'stripe_https'
      AND preflight.authenticity_kind = 'provider_read'
      AND preflight.runtime_run_id <> ''
      AND preflight.account_charges_enabled = true
      AND preflight.account_payouts_enabled = true
      AND preflight.account_country = 'US'
      AND preflight.account_business_type = 'company'
      AND preflight.checked_at <= operation.updated_at
      AND completion.payment_status = 'paid'
      AND completion.session_status = 'complete'
      AND completion.amount_total = 1499
      AND completion.currency = 'usd'
      AND completion.completed_at <= effective_at
      AND checkout_event.provider = 'stripe'
      AND checkout_event.environment = 'production'
      AND checkout_event.external_event_id = completion.provider_event_id
      AND checkout_event.event_type IN (
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded'
      )
      AND checkout_event.provider_api_version = preflight.api_version
      AND checkout_event.provider_object_id = completion.provider_session_id
      AND checkout_event.authenticity = 'verified'
      AND checkout_event.status = 'processed'
      AND checkout_event.application_state = 'applied'
      AND checkout_event.evidence_tier = 'live_production'
      AND checkout_event.transport_kind = 'stripe_https'
      AND checkout_event.transport_livemode = true
      AND checkout_event.runtime_run_id <> ''
      AND checkout_event.signature_verified_at IS NOT NULL
      AND paid.amount_paid = 1499
      AND paid.amount_remaining = 0
      AND paid.currency = 'usd'
      AND paid.quantity = 1
      AND paid.discount_amount = 0
      AND paid.tax_amount = 0
      AND paid.provider_payment_intent_id IS NOT NULL
      AND paid.provider_invoice_payment_id IS NOT NULL
      AND paid.evidence_digest = invoice_event.payload_hmac
      AND paid.provider_paid_at <= effective_at
      AND paid.recorded_at <= effective_at
      AND invoice_authority.invoice_discounts_empty = true
      AND invoice_authority.invoice_taxes_empty = true
      AND invoice_authority.invoice_credits_empty = true
      AND invoice_authority.subscription_page_complete = true
      AND invoice_event.provider = 'stripe'
      AND invoice_event.environment = 'production'
      AND invoice_event.event_type = 'invoice.paid'
      AND invoice_event.provider_api_version = preflight.api_version
      AND invoice_event.provider_object_id = paid.provider_invoice_id
      AND invoice_event.authenticity = 'verified'
      AND invoice_event.status = 'processed'
      AND invoice_event.application_state = 'ignored'
      AND invoice_event.error_code = 'provider.reconciled_from_snapshot'
      AND invoice_event.evidence_tier = 'live_production'
      AND invoice_event.transport_kind = 'stripe_https'
      AND invoice_event.transport_livemode = true
      AND invoice_event.runtime_run_id <> ''
      AND invoice_event.signature_verified_at IS NOT NULL
      AND current_event.provider_object_id = provider.external_subscription_id
      AND current_event.provider_event_created_at = provider.last_provider_event_created_at
      AND current_event.provider_api_version = provider.last_provider_api_version
      AND current_event.provider_api_version = preflight.api_version
      AND current_event.authenticity = 'verified'
      AND current_event.status = 'processed'
      AND current_event.application_state = 'applied'
      AND current_event.evidence_tier = 'live_production'
      AND current_event.transport_kind = 'stripe_https'
      AND current_event.transport_livemode = true
      AND current_event.runtime_run_id <> ''
      AND (
        current_event.event_type = 'subscription.reconciliation'
        OR (
          current_event.event_type IN (
            'customer.subscription.created',
            'customer.subscription.updated'
          )
          AND current_event.signature_verified_at IS NOT NULL
        )
      )
      AND (
        (
          subscription.lifecycle IN ('active','cancel_at_period_end','restored')
          AND provider.raw_state = subscription.lifecycle
          AND current_event.normalized_lifecycle = subscription.lifecycle
          AND paid.period_starts_at = subscription.current_period_starts_at
          AND paid.period_ends_at = subscription.current_period_ends_at
          AND paid.period_starts_at <= effective_at
          AND paid.period_ends_at > effective_at
        )
        OR (
          subscription.lifecycle = 'grace'
          AND provider.raw_state = current_event.normalized_lifecycle
          AND provider.raw_state IN ('grace','delinquent')
          AND current_event.event_type = 'subscription.reconciliation'
          AND paid.period_starts_at = subscription.current_period_starts_at
          AND EXISTS (
            SELECT 1
            FROM commerce_stripe_dunning_events opened
            JOIN commerce_stripe_failed_invoice_evidence failed
              ON failed.source_inbox_id = opened.source_inbox_id
             AND failed.environment = opened.environment
             AND failed.household_id = opened.household_id
             AND failed.subscription_id = opened.subscription_id
             AND failed.provider_invoice_id = opened.provider_invoice_id
            JOIN commerce_event_inbox failed_event
              ON failed_event.id = failed.source_inbox_id
            WHERE opened.environment = 'production'
              AND opened.household_id = subscription.household_id
              AND opened.subscription_id = subscription.id
              AND opened.event_kind = 'opened'
              AND opened.provider_invoice_id = failed.provider_invoice_id
              AND opened.evidence_digest = failed.evidence_digest
              AND opened.evidence_digest = failed_event.payload_hmac
              AND opened.paid_through_at = paid.period_ends_at
              AND opened.grace_starts_at = paid.period_ends_at
              AND opened.grace_ends_at = subscription.current_period_ends_at
              AND opened.grace_starts_at <= effective_at
              AND opened.grace_ends_at > effective_at
              AND opened.occurred_at <= effective_at
              AND failed.provider_subscription_id = provider.external_subscription_id
              AND failed.provider_subscription_item_id = paid.provider_subscription_item_id
              AND failed.provider_invoice_payment_id IS NOT NULL
              AND failed.provider_invoice_line_id IS NOT NULL
              AND failed.provider_product_id = invoice_authority.provider_product_id
              AND failed.provider_price_id = invoice_authority.provider_price_id
              AND failed.amount_due = offer.unit_amount_minor
              AND failed.currency = offer.currency
              AND failed.quantity = offer.quantity
              AND failed.line_proration = false
              AND failed.period_starts_at <= paid.period_ends_at
              AND failed.period_ends_at >= paid.period_ends_at
              AND failed.occurred_at <= effective_at
              AND failed_event.provider = 'stripe'
              AND failed_event.environment = 'production'
              AND failed_event.event_type IN (
                'invoice.payment_failed',
                'invoice.payment_action_required'
              )
              AND failed_event.provider_api_version = preflight.api_version
              AND failed_event.provider_object_id = failed.provider_invoice_id
              AND failed_event.normalized_lifecycle = 'delinquent'
              AND failed_event.authenticity = 'verified'
              AND failed_event.status = 'processed'
              AND failed_event.application_state = 'ignored'
              AND failed_event.error_code = 'provider.reconciled_from_snapshot'
              AND failed_event.evidence_tier = 'live_production'
              AND failed_event.transport_kind = 'stripe_https'
              AND failed_event.transport_livemode = true
              AND failed_event.runtime_run_id <> ''
              AND failed_event.signature_verified_at IS NOT NULL
              AND failed_event.provider_event_created_at <= effective_at
              AND NOT EXISTS (
                SELECT 1
                FROM commerce_stripe_dunning_events closure
                WHERE closure.dunning_window_key = opened.dunning_window_key
                  AND closure.environment = opened.environment
                  AND closure.household_id = opened.household_id
                  AND closure.subscription_id = opened.subscription_id
                  AND closure.provider_invoice_id = opened.provider_invoice_id
                  AND closure.event_kind IN ('recovered','expired')
                  AND closure.occurred_at <= effective_at
              )
          )
        )
      )
  );
END;
$$;

CREATE FUNCTION founding_household_allowance_grant_supports(
  target_household_id text,
  target_grant_id text,
  target_allowance_key text,
  effective_at timestamptz,
  require_spare_capacity boolean,
  target_runtime_environment text
) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  allowance_limit integer;
  active_usage integer;
BEGIN
  IF target_runtime_environment IS NULL
    OR target_runtime_environment NOT IN ('local','production') THEN
    RETURN false;
  END IF;

  SELECT (allowance.value->>'limit')::integer INTO allowance_limit
  FROM entitlement_grants grant_record
  JOIN commerce_subscriptions subscription
    ON subscription.household_id = grant_record.household_id
   AND subscription.id = grant_record.subscription_id
   AND subscription.plan_version_id = grant_record.plan_version_id
  JOIN commerce_plan_versions plan ON plan.id = grant_record.plan_version_id
  JOIN commerce_product_versions product ON product.id = plan.product_version_id
  CROSS JOIN LATERAL jsonb_array_elements(plan.allowances) allowance(value)
  WHERE grant_record.household_id = target_household_id
    AND grant_record.id = target_grant_id
    AND grant_record.source_verified = true
    AND grant_record.starts_at <= effective_at
    AND (grant_record.ends_at IS NULL OR grant_record.ends_at > effective_at)
    AND grant_record.revoked_at IS NULL
    AND subscription.source_verified = true
    AND subscription.lifecycle IN ('trialing','active','grace','cancel_at_period_end','restored')
    AND subscription.current_period_starts_at <= effective_at
    AND (
      subscription.current_period_ends_at IS NULL
      OR subscription.current_period_ends_at > effective_at
    )
    AND plan.available_from <= effective_at
    AND (plan.available_until IS NULL OR plan.available_until > effective_at)
    AND product.available_from <= effective_at
    AND (product.available_until IS NULL OR product.available_until > effective_at)
    AND (
      plan.state = 'active'
      OR (
        plan.state = 'hypothesis'
        AND commerce_hypothesis_subscription_backing_supports(
          subscription.household_id,
          subscription.id,
          target_runtime_environment,
          effective_at
        )
      )
    )
    AND (
      subscription.source <> 'sponsor'
      OR EXISTS (
        SELECT 1
        FROM commerce_sponsorship_allocations sponsor_allocation
        JOIN commerce_sponsorships sponsorship
          ON sponsorship.id = sponsor_allocation.sponsorship_id
        JOIN organizations organization
          ON organization.id = sponsorship.organization_id
        WHERE sponsor_allocation.household_id = grant_record.household_id
          AND sponsor_allocation.id = grant_record.sponsorship_id
          AND sponsor_allocation.state = 'active'
          AND sponsor_allocation.source_verified = true
          AND sponsor_allocation.starts_at <= effective_at
          AND (sponsor_allocation.ends_at IS NULL OR sponsor_allocation.ends_at > effective_at)
          AND sponsorship.state = 'active'
          AND sponsorship.starts_at <= effective_at
          AND (sponsorship.ends_at IS NULL OR sponsorship.ends_at > effective_at)
          AND organization.verification_state = CASE
            WHEN target_runtime_environment = 'production' THEN 'verified'
            ELSE 'local_fixture'
          END
      )
    )
    AND allowance.value->>'kind' = target_allowance_key
    AND NOT EXISTS (
      SELECT 1
      FROM founding_household_enrollments other_founding
      WHERE other_founding.household_id = grant_record.household_id
        AND other_founding.entitlement_grant_id = grant_record.id
    )
  ORDER BY grant_record.precedence DESC, grant_record.id
  LIMIT 1;

  IF allowance_limit IS NULL THEN
    RETURN false;
  END IF;

  SELECT count(*)::integer INTO active_usage
  FROM commerce_allowance_allocations allocation
  WHERE allocation.household_id = target_household_id
    AND allocation.entitlement_grant_id = target_grant_id
    AND allocation.allowance_key = target_allowance_key
    AND allocation.state = 'active';

  IF require_spare_capacity THEN
    RETURN active_usage < allowance_limit;
  END IF;
  RETURN active_usage <= allowance_limit;
END;
$$;

CREATE OR REPLACE FUNCTION founding_household_allowance_grant_supports(
  target_household_id text,
  target_grant_id text,
  target_allowance_key text,
  effective_at timestamptz,
  require_spare_capacity boolean
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT false;
$$;

CREATE OR REPLACE FUNCTION require_founding_household_enrollment_completion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_enrollment founding_household_enrollments%ROWTYPE;
BEGIN
  SELECT * INTO current_enrollment
  FROM founding_household_enrollments enrollment
  WHERE enrollment.id = NEW.id;

  IF current_enrollment.state = 'active' AND NOT EXISTS (
    SELECT 1 FROM founding_household_invitations invitation
    WHERE invitation.id = current_enrollment.invitation_id
      AND invitation.state = 'accepted'
      AND invitation.credential_fingerprint IS NULL
      AND invitation.ended_at = current_enrollment.starts_at
      AND invitation.terminal_operation_key = current_enrollment.operation_key
  ) THEN
    RAISE EXCEPTION 'Founding Household enrollment commit must accept and zeroize its invitation';
  END IF;
  IF current_enrollment.state = 'active' AND NOT founding_household_has_exact_service_consent(
    current_enrollment.household_id,
    current_enrollment.service_consent_id,
    current_enrollment.accepted_by_person_id,
    current_enrollment.accepted_session_id,
    current_enrollment.cohort_key,
    current_enrollment.benefit_key,
    current_enrollment.environment,
    current_enrollment.starts_at,
    current_enrollment.ends_at
  ) THEN
    RAISE EXCEPTION 'Founding Household enrollment commit requires exact current service consent';
  END IF;
  IF current_enrollment.state = 'active' AND NOT founding_household_has_exact_protected_consent(
    current_enrollment.household_id,
    current_enrollment.accepted_by_person_id,
    current_enrollment.accepted_session_id,
    current_enrollment.environment,
    current_enrollment.starts_at,
    current_enrollment.entitlement_grant_id,
    current_enrollment.protected_enrollment_created
  ) THEN
    RAISE EXCEPTION 'Founding Household enrollment commit requires exact protected-adult consent';
  END IF;
  IF current_enrollment.state = 'revoked' AND EXISTS (
    SELECT 1 FROM commerce_allowance_allocations allowance
    WHERE allowance.household_id = current_enrollment.household_id
      AND allowance.entitlement_grant_id = current_enrollment.entitlement_grant_id
      AND allowance.state = 'active'
      AND EXISTS (
        SELECT 1 FROM entitlement_grants candidate
        WHERE candidate.household_id = allowance.household_id
          AND candidate.id <> current_enrollment.entitlement_grant_id
          AND founding_household_allowance_grant_supports(
            allowance.household_id,
            candidate.id,
            allowance.allowance_key,
            current_enrollment.revoked_at,
            true,
            CASE
              WHEN current_enrollment.environment = 'production' THEN 'production'
              ELSE 'local'
            END
          )
      )
  ) THEN
    RAISE EXCEPTION 'Founding Household offboarding commit must rebind supported allowances';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION require_founding_household_allowance_rebinding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  founding_enrollment founding_household_enrollments%ROWTYPE;
  transition_kind text;
  transition_to_grant_id text;
BEGIN
  SELECT * INTO founding_enrollment
  FROM founding_household_enrollments enrollment
  WHERE enrollment.household_id = OLD.household_id
    AND enrollment.entitlement_grant_id = OLD.entitlement_grant_id;
  IF founding_enrollment.id IS NULL OR founding_enrollment.state <> 'revoked' THEN
    RETURN NEW;
  END IF;
  IF founding_enrollment.revocation_operation_key IS NULL THEN
    RAISE EXCEPTION 'Founding Household allowance transition requires exact offboarding operation';
  END IF;
  IF NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.allowance_key IS DISTINCT FROM OLD.allowance_key
    OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind
    OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
    OR NEW.allocated_at IS DISTINCT FROM OLD.allocated_at THEN
    RAISE EXCEPTION 'Founding Household offboarding cannot rewrite allowance identity';
  END IF;
  IF NEW.state = 'active' THEN
    IF NEW.entitlement_grant_id = OLD.entitlement_grant_id
      OR NEW.released_at IS NOT NULL
      OR NOT founding_household_allowance_grant_supports(
        NEW.household_id,
        NEW.entitlement_grant_id,
        NEW.allowance_key,
        founding_enrollment.revoked_at,
        false,
        CASE
          WHEN founding_enrollment.environment = 'production' THEN 'production'
          ELSE 'local'
        END
      ) THEN
      RAISE EXCEPTION 'Founding Household allowance must rebind to an effective unrelated grant';
    END IF;
    transition_kind := 'rebind';
    transition_to_grant_id := NEW.entitlement_grant_id;
  ELSIF NEW.state = 'released' THEN
    IF NEW.entitlement_grant_id IS DISTINCT FROM OLD.entitlement_grant_id
      OR NEW.released_at IS DISTINCT FROM founding_enrollment.revoked_at THEN
      RAISE EXCEPTION 'Founding Household allowance release must match exact offboarding';
    END IF;
    IF EXISTS (
      SELECT 1 FROM entitlement_grants candidate
      WHERE candidate.household_id = NEW.household_id
        AND candidate.id <> OLD.entitlement_grant_id
        AND founding_household_allowance_grant_supports(
          NEW.household_id,
          candidate.id,
          NEW.allowance_key,
          founding_enrollment.revoked_at,
          true,
          CASE
            WHEN founding_enrollment.environment = 'production' THEN 'production'
            ELSE 'local'
          END
        )
    ) THEN
      RAISE EXCEPTION 'Founding Household allowance cannot release while an unrelated grant supports it';
    END IF;
    transition_kind := 'release';
    transition_to_grant_id := NULL;
  ELSE
    RAISE EXCEPTION 'Founding Household allowance offboarding state is invalid';
  END IF;

  INSERT INTO founding_household_allowance_transitions(
    operation_key, enrollment_id, household_id, allowance_allocation_id,
    allowance_key, from_grant_id, to_grant_id, transition_kind, occurred_at
  ) VALUES (
    founding_enrollment.revocation_operation_key,
    founding_enrollment.id,
    OLD.household_id,
    OLD.id,
    OLD.allowance_key,
    OLD.entitlement_grant_id,
    transition_to_grant_id,
    transition_kind,
    founding_enrollment.revoked_at
  );
  RETURN NEW;
END;
$$;
