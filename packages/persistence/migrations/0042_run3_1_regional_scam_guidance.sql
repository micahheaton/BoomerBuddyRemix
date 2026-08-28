-- Add immutable, in-app-only regional briefs reviewed from official state
-- attorney general sources. These rows do not fetch, generate, notify, or
-- permit external delivery.
INSERT INTO member_scam_guidance_briefs(
  brief_key, version, region_code, title, summary, safe_actions,
  source_title, source_url, source_published_at, reviewed_at,
  published_at, expires_at, source_kind, review_state, publication_state,
  automation_generated, external_delivery_permitted, created_at
) VALUES (
  'az-crypto-atm-payment-demand',
  1,
  'US-AZ',
  'Arizona: crypto ATM payment demands',
  'The Arizona Attorney General warns about callers who impersonate a bank, government agency, or utility and demand an immediate cash deposit at a cryptocurrency ATM. A real organization should not require a crypto ATM to resolve an account problem, tax, or service shutoff.',
  '["Hang up and do not follow the caller''s payment instructions.","Contact the named organization through a number you find independently.","If money moved, save the kiosk receipt and contact the kiosk operator promptly.","Report suspected fraud promptly to local law enforcement or the Arizona Attorney General."]'::jsonb,
  'Arizona Attorney General: Crypto ATM scams targeting seniors',
  'https://www.azag.gov/press-release/attorney-general-mayes-better-business-bureau-warn-arizonans-about-crypto-atm-scams',
  '2026-03-25T12:00:00.000Z',
  '2026-08-28T07:28:00.000Z',
  '2026-08-28T07:28:00.000Z',
  '2026-11-26T12:00:00.000Z',
  'public_official',
  'approved',
  'in_app_only',
  false,
  false,
  '2026-08-28T07:28:00.000Z'
), (
  'il-fake-traffic-toll-text',
  1,
  'US-IL',
  'Illinois: fake traffic and toll text messages',
  'The Illinois Attorney General warns that unsolicited texts may claim a traffic or toll violation and demand payment or personal information. A familiar number, local area code, logo, or official-looking letter does not make the message authentic.',
  '["Do not open a link, attachment, or QR code in an unexpected message.","Do not reply to a suspicious text, even to say STOP.","Check any claimed toll through the official Illinois Tollway site or number you find independently.","If you already interacted, monitor financial accounts and secure any credentials you entered."]'::jsonb,
  'Illinois Attorney General: Fake traffic violation text scams',
  'https://illinoisattorneygeneral.gov/news/story/consumer-alert-attorney-general-raoul-urges-illinoisans-to-be-alert-for-text-message-scams-involving-fake-traffic-violations',
  '2026-03-30T12:00:00.000Z',
  '2026-08-28T07:28:00.000Z',
  '2026-08-28T07:28:00.000Z',
  '2026-11-26T12:00:00.000Z',
  'public_official',
  'approved',
  'in_app_only',
  false,
  false,
  '2026-08-28T07:28:00.000Z'
), (
  'ny-gold-bar-account-emergency',
  1,
  'US-NY',
  'New York: fake account emergencies and gold pickups',
  'The New York Attorney General warns about fake security messages that lead to remote computer access and claims that savings must be moved into gold for protection. Secrecy, immediate money movement, and a courier pickup are warning signs, not safeguards.',
  '["Do not call a number shown in an unexpected pop-up, text, or email.","Do not give an unexpected contact remote access to a computer.","Never move money or buy gold because a caller says an account is in danger.","Hang up and call the financial institution using the number on a statement or card."]'::jsonb,
  'New York Attorney General: Gold bar scams targeting seniors',
  'https://ag.ny.gov/press-release/2026/attorney-general-james-warns-new-yorkers-gold-bar-scam-targeting-seniors',
  '2026-08-07T12:00:00.000Z',
  '2026-08-28T07:28:00.000Z',
  '2026-08-28T07:28:00.000Z',
  '2026-11-26T12:00:00.000Z',
  'public_official',
  'approved',
  'in_app_only',
  false,
  false,
  '2026-08-28T07:28:00.000Z'
), (
  'pa-cash-courier-emergency',
  1,
  'US-PA',
  'Pennsylvania: cash courier emergency scams',
  'The Pennsylvania Attorney General warns about false emergencies that demand immediate cash and send an unknown person to collect it. A supposed fine or family emergency should be verified separately before money or sensitive information changes hands.',
  '["Do not hand cash to an unknown pickup person.","End a call, text, email, or doorstep contact that pressures you to pay immediately.","Verify a business, agency, or family emergency through a number you find independently.","Do not share bank details, passwords, PINs, or other sensitive information with the requester."]'::jsonb,
  'Pennsylvania Attorney General: Cash scams involving trusted-person pickups',
  'https://www.attorneygeneral.gov/taking-action/attorney-general-sunday-warns-pennsylvanians-of-cash-scams-involving-trusted-person-pickups/',
  '2026-04-20T12:00:00.000Z',
  '2026-08-28T07:28:00.000Z',
  '2026-08-28T07:28:00.000Z',
  '2026-11-26T12:00:00.000Z',
  'public_official',
  'approved',
  'in_app_only',
  false,
  false,
  '2026-08-28T07:28:00.000Z'
) ON CONFLICT (brief_key, version) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    WITH expected(
      brief_key, version, region_code, title, summary, safe_actions,
      source_title, source_url, source_published_at, reviewed_at,
      published_at, expires_at
    ) AS (
      VALUES
        (
          'az-crypto-atm-payment-demand', 1, 'US-AZ',
          'Arizona: crypto ATM payment demands',
          'The Arizona Attorney General warns about callers who impersonate a bank, government agency, or utility and demand an immediate cash deposit at a cryptocurrency ATM. A real organization should not require a crypto ATM to resolve an account problem, tax, or service shutoff.',
          '["Hang up and do not follow the caller''s payment instructions.","Contact the named organization through a number you find independently.","If money moved, save the kiosk receipt and contact the kiosk operator promptly.","Report suspected fraud promptly to local law enforcement or the Arizona Attorney General."]'::jsonb,
          'Arizona Attorney General: Crypto ATM scams targeting seniors',
          'https://www.azag.gov/press-release/attorney-general-mayes-better-business-bureau-warn-arizonans-about-crypto-atm-scams',
          '2026-03-25T12:00:00.000Z'::timestamptz,
          '2026-08-28T07:28:00.000Z'::timestamptz,
          '2026-08-28T07:28:00.000Z'::timestamptz,
          '2026-11-26T12:00:00.000Z'::timestamptz
        ),
        (
          'il-fake-traffic-toll-text', 1, 'US-IL',
          'Illinois: fake traffic and toll text messages',
          'The Illinois Attorney General warns that unsolicited texts may claim a traffic or toll violation and demand payment or personal information. A familiar number, local area code, logo, or official-looking letter does not make the message authentic.',
          '["Do not open a link, attachment, or QR code in an unexpected message.","Do not reply to a suspicious text, even to say STOP.","Check any claimed toll through the official Illinois Tollway site or number you find independently.","If you already interacted, monitor financial accounts and secure any credentials you entered."]'::jsonb,
          'Illinois Attorney General: Fake traffic violation text scams',
          'https://illinoisattorneygeneral.gov/news/story/consumer-alert-attorney-general-raoul-urges-illinoisans-to-be-alert-for-text-message-scams-involving-fake-traffic-violations',
          '2026-03-30T12:00:00.000Z'::timestamptz,
          '2026-08-28T07:28:00.000Z'::timestamptz,
          '2026-08-28T07:28:00.000Z'::timestamptz,
          '2026-11-26T12:00:00.000Z'::timestamptz
        ),
        (
          'ny-gold-bar-account-emergency', 1, 'US-NY',
          'New York: fake account emergencies and gold pickups',
          'The New York Attorney General warns about fake security messages that lead to remote computer access and claims that savings must be moved into gold for protection. Secrecy, immediate money movement, and a courier pickup are warning signs, not safeguards.',
          '["Do not call a number shown in an unexpected pop-up, text, or email.","Do not give an unexpected contact remote access to a computer.","Never move money or buy gold because a caller says an account is in danger.","Hang up and call the financial institution using the number on a statement or card."]'::jsonb,
          'New York Attorney General: Gold bar scams targeting seniors',
          'https://ag.ny.gov/press-release/2026/attorney-general-james-warns-new-yorkers-gold-bar-scam-targeting-seniors',
          '2026-08-07T12:00:00.000Z'::timestamptz,
          '2026-08-28T07:28:00.000Z'::timestamptz,
          '2026-08-28T07:28:00.000Z'::timestamptz,
          '2026-11-26T12:00:00.000Z'::timestamptz
        ),
        (
          'pa-cash-courier-emergency', 1, 'US-PA',
          'Pennsylvania: cash courier emergency scams',
          'The Pennsylvania Attorney General warns about false emergencies that demand immediate cash and send an unknown person to collect it. A supposed fine or family emergency should be verified separately before money or sensitive information changes hands.',
          '["Do not hand cash to an unknown pickup person.","End a call, text, email, or doorstep contact that pressures you to pay immediately.","Verify a business, agency, or family emergency through a number you find independently.","Do not share bank details, passwords, PINs, or other sensitive information with the requester."]'::jsonb,
          'Pennsylvania Attorney General: Cash scams involving trusted-person pickups',
          'https://www.attorneygeneral.gov/taking-action/attorney-general-sunday-warns-pennsylvanians-of-cash-scams-involving-trusted-person-pickups/',
          '2026-04-20T12:00:00.000Z'::timestamptz,
          '2026-08-28T07:28:00.000Z'::timestamptz,
          '2026-08-28T07:28:00.000Z'::timestamptz,
          '2026-11-26T12:00:00.000Z'::timestamptz
        )
    )
    SELECT 1
    FROM expected
    LEFT JOIN member_scam_guidance_briefs actual
      ON actual.brief_key = expected.brief_key
     AND actual.version = expected.version
    WHERE actual.brief_key IS NULL
       OR actual.region_code IS DISTINCT FROM expected.region_code
       OR actual.title IS DISTINCT FROM expected.title
       OR actual.summary IS DISTINCT FROM expected.summary
       OR actual.safe_actions IS DISTINCT FROM expected.safe_actions
       OR actual.source_title IS DISTINCT FROM expected.source_title
       OR actual.source_url IS DISTINCT FROM expected.source_url
       OR actual.source_published_at IS DISTINCT FROM expected.source_published_at
       OR actual.reviewed_at IS DISTINCT FROM expected.reviewed_at
       OR actual.published_at IS DISTINCT FROM expected.published_at
       OR actual.expires_at IS DISTINCT FROM expected.expires_at
       OR actual.source_kind <> 'public_official'
       OR actual.review_state <> 'approved'
       OR actual.publication_state <> 'in_app_only'
       OR actual.automation_generated
       OR actual.external_delivery_permitted
  ) THEN
    RAISE EXCEPTION 'Regional member scam guidance catalogue conflict';
  END IF;
END;
$$;
