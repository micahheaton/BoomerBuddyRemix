import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { runMigrations } from './migrations';

describe('versioned Stripe offer catalogue migration', () => {
  let database: Database | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('installs the exact immutable monthly and annual offer contracts without opening live', async () => {
    database = await createPGliteDatabase(':memory:');
    const applied = await runMigrations(database);
    expect(applied).toContain('0044_versioned_stripe_offer_catalog.sql');

    const offers = await database.query<
      {
        readonly offer_id: string;
        readonly plan_version_id: string;
        readonly billing_interval: 'month' | 'year';
        readonly unit_amount_minor: number;
        readonly trial_period_days: number;
        readonly customer_selectable: boolean;
        readonly default_acquisition_offer: boolean;
      } & Record<string, unknown>
    >(
      `SELECT offer_id, plan_version_id, billing_interval, unit_amount_minor,
              trial_period_days, customer_selectable, default_acquisition_offer
       FROM commerce_stripe_offer_contracts
       ORDER BY offer_id`,
    );
    expect(offers.rows).toEqual([
      {
        offer_id: 'family_annual_v2',
        plan_version_id: 'family_v3',
        billing_interval: 'year',
        unit_amount_minor: 14990,
        trial_period_days: 7,
        customer_selectable: true,
        default_acquisition_offer: true,
      },
      {
        offer_id: 'family_monthly_v2',
        plan_version_id: 'family_v3',
        billing_interval: 'month',
        unit_amount_minor: 1499,
        trial_period_days: 0,
        customer_selectable: true,
        default_acquisition_offer: false,
      },
      {
        offer_id: 'founding_family_monthly_v1',
        plan_version_id: 'family_v1',
        billing_interval: 'month',
        unit_amount_minor: 1499,
        trial_period_days: 0,
        customer_selectable: false,
        default_acquisition_offer: false,
      },
      {
        offer_id: 'individual_annual_v1',
        plan_version_id: 'individual_v3',
        billing_interval: 'year',
        unit_amount_minor: 8990,
        trial_period_days: 7,
        customer_selectable: true,
        default_acquisition_offer: false,
      },
      {
        offer_id: 'individual_monthly_v1',
        plan_version_id: 'individual_v3',
        billing_interval: 'month',
        unit_amount_minor: 899,
        trial_period_days: 0,
        customer_selectable: true,
        default_acquisition_offer: false,
      },
    ]);

    expect(14990).toBe(1499 * 10);
    expect(8990).toBe(899 * 10);
    const individualPlan = await database.query<{ readonly allowances: unknown }>(
      `SELECT allowances FROM commerce_plan_versions WHERE id = 'individual_v3'`,
    );
    expect(individualPlan.rows[0]?.allowances).toEqual([
      { kind: 'protected_members', limit: 1 },
      { kind: 'trusted_circle_participants', limit: 2 },
    ]);
    await expect(
      database.query(
        `INSERT INTO commerce_stripe_offer_contracts(
           offer_id, plan_version_id, plan_key, display_name, billing_interval, currency,
           unit_amount_minor, quantity, trial_period_days, customer_selectable,
           default_acquisition_offer, promotions_enabled, automatic_tax_enabled,
           adaptive_pricing_enabled, created_at
         ) VALUES (
           'family_annual_v2','family_v3','family','Family','year','usd',14900,1,7,true,true,
           false,false,false,CURRENT_TIMESTAMP
         )`,
      ),
    ).rejects.toThrow();

    const liveControl = await database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count
       FROM commerce_stripe_initiation_controls
       WHERE environment = 'production' AND state = 'enabled'`,
    );
    expect(liveControl.rows).toEqual([{ count: 0 }]);
  }, 120_000);

  it('adds append-only trial, reminder, and customer authority evidence tables', async () => {
    database = await createPGliteDatabase(':memory:');
    await runMigrations(database);
    const columns = await database.query<{
      readonly table_name: string;
      readonly column_name: string;
    }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (
           (table_name = 'commerce_stripe_checkout_completions_v2'
             AND column_name IN ('offer_id','payment_method_collection'))
           OR (table_name = 'commerce_stripe_trial_reminder_intents'
             AND column_name IN ('offer_id','trial_ends_at','charge_amount_minor','disclosure'))
           OR (table_name = 'commerce_stripe_trial_reminder_acknowledgements'
             AND column_name IN ('reminder_intent_id','idempotency_key','acknowledged_at'))
           OR (table_name = 'commerce_stripe_trial_reservations'
             AND column_name IN ('person_id','offer_family','checkout_intent_id','idempotency_key'))
           OR (table_name = 'commerce_stripe_trial_checkout_attempts'
             AND column_name IN (
               'reservation_id','checkout_intent_id','subscription_id',
               'attempt_number','idempotency_key','recorded_at'
             ))
           OR (table_name = 'commerce_stripe_trial_consumptions'
             AND column_name IN ('reservation_id','provider_session_id','source_inbox_id'))
           OR (table_name = 'commerce_stripe_trial_period_evidence'
             AND column_name IN ('offer_id','trial_starts_at','trial_ends_at','payment_method_present'))
           OR (table_name = 'household_billing_authority_events'
             AND column_name IN (
               'transition_source','request_digest','actor_session_id',
               'billing_reverification_binding_id','consent_document_version',
               'consent_document_digest'
             ))
         )
       ORDER BY table_name, column_name`,
    );
    expect(columns.rows).toHaveLength(32);
    const attemptTriggers = await database.query<{ readonly trigger_name: string }>(
      `SELECT trigger.tgname AS trigger_name
       FROM pg_trigger trigger
       JOIN pg_class table_record ON table_record.oid = trigger.tgrelid
       WHERE table_record.relname = 'commerce_stripe_trial_checkout_attempts'
         AND NOT trigger.tgisinternal
       ORDER BY trigger.tgname`,
    );
    expect(attemptTriggers.rows).toEqual([
      { trigger_name: 'commerce_stripe_trial_checkout_attempt_lineage_guard' },
      { trigger_name: 'commerce_stripe_trial_checkout_attempts_append_only' },
    ]);
  }, 120_000);

  it('requires an active administrator for an exact household-member self-grant', async () => {
    database = await createPGliteDatabase(':memory:');
    await runMigrations(database);
    const now = '2026-08-28T12:00:00.000Z';
    await database.query(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-authority-fixture','Authority fixture',$1)`,
      [now],
    );
    await database.query(
      `INSERT INTO households(id, name, created_at)
       VALUES ('household-authority-fixture','Authority fixture',$1)`,
      [now],
    );
    await database.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES (
         'household-authority-fixture','membership-authority-fixture',
         'person-authority-fixture','member','active',$1
       )`,
      [now],
    );
    const insertAuthority = () =>
      database!.query(
        `INSERT INTO household_billing_authorities(
           household_id, person_id, status, granted_by_person_id, granted_at, grant_source
         ) VALUES (
           'household-authority-fixture','person-authority-fixture','active',
           'person-authority-fixture',$1,'household_member'
         )`,
        [now],
      );
    await expect(insertAuthority()).rejects.toThrow(
      'Household billing authority requires exact administrator self-grant',
    );
    await database.query(
      `INSERT INTO household_administrator_assignments(
         household_id, person_id, status, granted_by_person_id, granted_at
       ) VALUES (
         'household-authority-fixture','person-authority-fixture','active',
         'person-authority-fixture',$1
       )`,
      [now],
    );
    await expect(insertAuthority()).resolves.toMatchObject({ rowCount: 1 });
    const authority = await database.query<{
      readonly grant_source: string;
      readonly granted_by_person_id: string;
    }>(
      `SELECT grant_source, granted_by_person_id
       FROM household_billing_authorities
       WHERE household_id = 'household-authority-fixture'
         AND person_id = 'person-authority-fixture'`,
    );
    expect(authority.rows).toEqual([
      {
        grant_source: 'household_member',
        granted_by_person_id: 'person-authority-fixture',
      },
    ]);
  }, 120_000);
});
