ALTER TABLE public_check_contexts
  ADD COLUMN continuity_hmac text;

ALTER TABLE public_check_contexts
  ADD COLUMN continuity_hmac_key_version integer;

ALTER TABLE public_check_contexts
  ADD CONSTRAINT public_check_context_continuity_pair_check CHECK (
    (continuity_hmac IS NULL AND continuity_hmac_key_version IS NULL)
    OR (
      continuity_hmac IS NOT NULL
      AND continuity_hmac ~ '^[A-Za-z0-9_-]{43}$'
      AND continuity_hmac_key_version IS NOT NULL
      AND continuity_hmac_key_version > 0
    )
  );

CREATE UNIQUE INDEX public_check_context_continuity_hmac_idx
  ON public_check_contexts(continuity_hmac)
  WHERE continuity_hmac IS NOT NULL;

ALTER TABLE public_check_conversions
  ADD COLUMN semantics_version text NOT NULL DEFAULT 'single-success-retry-v1';

ALTER TABLE public_check_conversions
  ADD CONSTRAINT public_check_conversion_semantics_version_check CHECK (
    semantics_version = 'single-success-retry-v1'
  );
