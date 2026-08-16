ALTER TABLE public_check_contexts
  ADD CONSTRAINT public_check_context_attribution_unique
    UNIQUE (id, attribution_source, attribution_campaign);

ALTER TABLE public_check_results
  ADD COLUMN context_id text,
  ADD COLUMN attribution_source text,
  ADD COLUMN attribution_campaign text,
  ADD CONSTRAINT public_check_result_interaction_check CHECK (
    (context_id IS NULL AND attribution_source IS NULL AND attribution_campaign IS NULL)
    OR (
      context_id IS NOT NULL
      AND attribution_source IN ('direct', 'organic', 'partner', 'campaign')
      AND attribution_campaign IN ('none', 'launch_2026', 'trusted_partner')
    )
  ),
  ADD CONSTRAINT public_check_result_interaction_unique
    UNIQUE (id, context_id, attribution_source, attribution_campaign),
  ADD CONSTRAINT public_check_result_context_attribution_fk
    FOREIGN KEY (context_id, attribution_source, attribution_campaign)
    REFERENCES public_check_contexts(id, attribution_source, attribution_campaign);

CREATE TABLE public_check_conversions (
  result_id text NOT NULL,
  actor_person_id text NOT NULL,
  household_id text NOT NULL,
  context_id text NOT NULL,
  attribution_source text NOT NULL CHECK (
    attribution_source IN ('direct', 'organic', 'partner', 'campaign')
  ),
  attribution_campaign text NOT NULL CHECK (
    attribution_campaign IN ('none', 'launch_2026', 'trusted_partner')
  ),
  artifact_id text NOT NULL,
  analysis_id text NOT NULL,
  save_consent boolean NOT NULL CHECK (save_consent),
  consent_version text NOT NULL CHECK (consent_version = 'public-check-save-v1'),
  session_audience text NOT NULL CHECK (session_audience IN ('customer', 'mobile')),
  correlation_id text NOT NULL,
  credential_hmac text NOT NULL UNIQUE,
  hmac_key_version integer NOT NULL CHECK (hmac_key_version > 0),
  converted_at timestamptz NOT NULL,
  PRIMARY KEY (result_id, actor_person_id),
  UNIQUE (result_id),
  FOREIGN KEY (household_id, actor_person_id)
    REFERENCES household_memberships(household_id, person_id),
  FOREIGN KEY (household_id, artifact_id)
    REFERENCES artifacts(household_id, id),
  FOREIGN KEY (household_id, analysis_id)
    REFERENCES analyses(household_id, id)
);

CREATE INDEX public_check_conversion_actor_idx
  ON public_check_conversions(actor_person_id, converted_at DESC);

CREATE OR REPLACE FUNCTION validate_public_check_conversion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public_check_results result
    JOIN analyses analysis
      ON analysis.household_id = NEW.household_id
     AND analysis.id = NEW.analysis_id
    WHERE result.id = NEW.result_id
      AND result.context_id = NEW.context_id
      AND result.attribution_source = NEW.attribution_source
      AND result.attribution_campaign = NEW.attribution_campaign
      AND result.state = 'active'
      AND analysis.artifact_id = NEW.artifact_id
      AND analysis.requested_by = NEW.actor_person_id
      AND analysis.state = 'completed'
  ) THEN
    RAISE EXCEPTION 'Public Check conversion evidence does not match its interaction and owner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER public_check_conversions_validate
BEFORE INSERT ON public_check_conversions
FOR EACH ROW EXECUTE FUNCTION validate_public_check_conversion();

CREATE OR REPLACE FUNCTION reject_public_check_conversion_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Public Check conversion evidence is append-only';
END;
$$;

CREATE TRIGGER public_check_conversions_immutable
BEFORE UPDATE OR DELETE ON public_check_conversions
FOR EACH ROW EXECUTE FUNCTION reject_public_check_conversion_mutation();
