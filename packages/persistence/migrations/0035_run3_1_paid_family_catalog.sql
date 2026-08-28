-- Restore the immutable Family v1 catalogue row needed by the default-off monthly
-- Stripe offer. Deferred annual hypotheses remain outside the production catalogue.
INSERT INTO commerce_plan_versions(
  id, product_version_id, plan_key, version, display_name, state,
  capabilities, allowances, prices, available_from, created_at
) VALUES (
  'family_v1', 'consumer_household_v1', 'family', 1, 'Family', 'hypothesis',
  '["check:text","check:url","history:read","family:manage","orientation:use"]'::jsonb,
  '[{"kind":"protected_members","limit":3},{"kind":"trusted_circle_participants","limit":6}]'::jsonb,
  '[{"interval":"month","amountMinor":1499,"currency":"USD","kind":"list"}]'::jsonb,
  '2026-08-15T00:00:00.000Z', '2026-08-25T00:00:00.000Z'
) ON CONFLICT (id) DO NOTHING;

-- Older local databases may already contain this row with a seed-run-specific
-- created_at. Every effective immutable catalogue fact must still match.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM commerce_product_versions product
    WHERE product.id = 'consumer_household_v1'
      AND product.product_key = 'consumer_household'
      AND product.version = 1
      AND product.display_name = 'BoomerBuddy household protection'
      AND product.available_from = '2026-08-15T00:00:00.000Z'::timestamptz
      AND product.available_until IS NULL
  ) THEN
    RAISE EXCEPTION 'Paid Family product catalogue conflict';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce_plan_versions plan
    WHERE plan.id = 'family_v1'
      AND plan.product_version_id = 'consumer_household_v1'
      AND plan.plan_key = 'family'
      AND plan.version = 1
      AND plan.display_name = 'Family'
      AND plan.state = 'hypothesis'
      AND plan.capabilities =
        '["check:text","check:url","history:read","family:manage","orientation:use"]'::jsonb
      AND plan.allowances =
        '[{"kind":"protected_members","limit":3},{"kind":"trusted_circle_participants","limit":6}]'::jsonb
      AND plan.prices =
        '[{"interval":"month","amountMinor":1499,"currency":"USD","kind":"list"}]'::jsonb
      AND plan.available_from = '2026-08-15T00:00:00.000Z'::timestamptz
      AND plan.available_until IS NULL
  ) THEN
    RAISE EXCEPTION 'Paid Family plan catalogue conflict';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce_stripe_offer_contracts offer
    WHERE offer.offer_id = 'founding_family_monthly_v1'
      AND offer.plan_version_id = 'family_v1'
      AND offer.billing_interval = 'month'
      AND offer.currency = 'usd'
      AND offer.unit_amount_minor = 1499
      AND offer.quantity = 1
      AND offer.promotions_enabled = false
      AND offer.automatic_tax_enabled = false
      AND offer.adaptive_pricing_enabled = false
  ) THEN
    RAISE EXCEPTION 'Paid Family Stripe offer catalogue conflict';
  END IF;
END;
$$;

ALTER TABLE commerce_stripe_offer_contracts
  ADD CONSTRAINT commerce_stripe_offer_contracts_plan_version_fk
  FOREIGN KEY (plan_version_id)
  REFERENCES commerce_plan_versions(id) ON DELETE RESTRICT;
