'use client';

import { useState } from 'react';
import {
  orderedRevenueResearchIntervalOptions,
  revenueResearchAudienceDefinitions,
  revenueResearchPreviewStatusCopy,
  revenueResearchResponseChoices,
  type RevenueResearchAudience,
  type RevenueResearchPresentationOrder,
  type RevenueResearchResponseValue,
} from '../lib/revenue-research-preview';

export function RevenueResearchPreview({
  presentationOrders,
}: {
  readonly presentationOrders: Readonly<
    Record<RevenueResearchAudience, RevenueResearchPresentationOrder>
  >;
}) {
  const [audience, setAudience] = useState<RevenueResearchAudience>();
  const [response, setResponse] = useState<RevenueResearchResponseValue>();
  const definition = audience ? revenueResearchAudienceDefinitions[audience] : undefined;
  const intervalOptions =
    audience && definition
      ? orderedRevenueResearchIntervalOptions(audience, presentationOrders[audience])
      : [];

  function chooseAudience(nextAudience: RevenueResearchAudience) {
    setAudience(nextAudience);
    setResponse(undefined);
  }

  return (
    <main id="main-content" className="page-shell narrow">
      <span className="eyebrow">Local research lab</span>
      <h1 className="page-title">Offer-pair research preview</h1>
      <div className="notice notice-warning" role="note">
        <strong>This page cannot collect a response.</strong>
        <p>
          It is available only in an explicitly enabled local development or test runtime. It has no
          form, analytics, account lookup, durable storage, or provider connection. Any choice
          exists only in this open page and is not saved or sent.
        </p>
      </div>
      <p>
        <a href="/">Leave without responding</a>
      </p>

      <section className="card" aria-labelledby="research-coverage-heading">
        <h2 id="research-coverage-heading">Choose coverage before comparing billing intervals</h2>
        <p>No coverage choice is saved or sent.</p>
        <div className="button-row" role="group" aria-labelledby="research-coverage-heading">
          {(Object.keys(revenueResearchAudienceDefinitions) as RevenueResearchAudience[]).map(
            (candidateAudience) => (
              <button
                key={candidateAudience}
                className="button button-secondary"
                type="button"
                aria-pressed={audience === candidateAudience}
                onClick={() => chooseAudience(candidateAudience)}
              >
                {revenueResearchAudienceDefinitions[candidateAudience].label}
              </button>
            ),
          )}
        </div>
      </section>

      {audience && definition ? (
        <section
          className="card"
          aria-labelledby="research-interval-heading"
          style={{ marginTop: '1.5rem' }}
        >
          <h2 id="research-interval-heading">Compare {definition.label}</h2>
          <p className="notice notice-warning" role="note">
            {revenueResearchPreviewStatusCopy}
          </p>
          <div className="card-grid two" role="group" aria-labelledby="research-interval-heading">
            {intervalOptions.map((option) => (
              <button
                key={option.responseValue}
                className="button button-secondary"
                type="button"
                aria-pressed={response === option.responseValue}
                onClick={() => setResponse(option.responseValue)}
              >
                {option.copy}
              </button>
            ))}
          </div>
          <div
            className="button-row"
            role="group"
            aria-label="Other unavailable research responses"
          >
            {revenueResearchResponseChoices
              .filter((choice) => choice.value === 'neither' || choice.value === 'unsure')
              .map((choice) => (
                <button
                  key={choice.value}
                  className="button button-secondary"
                  type="button"
                  aria-pressed={response === choice.value}
                  onClick={() => setResponse(choice.value)}
                >
                  {choice.label}
                </button>
              ))}
          </div>
          <p aria-live="polite">
            {response
              ? `Local response: ${response}. This response has not been saved or sent.`
              : 'No response selected.'}
          </p>
          {response ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setResponse(undefined)}
            >
              Clear the response on this page
            </button>
          ) : null}

          <aside
            className="notice"
            style={{ marginTop: '1.5rem' }}
            aria-labelledby="referral-heading"
          >
            <h3 id="referral-heading">Unavailable referral service-credit hypothesis</h3>
            <p>
              No referral program is active. This research-only hypothesis is a non-cash,
              non-transferable subscription service credit. It cannot be redeemed, reserved, or
              earned from this page.
            </p>
            <ul className="plain-list">
              <li>{definition.referral.creditCopy} after a first settled subscription payment.</li>
              <li>{definition.referral.referrerAndHouseholdCapCopy}.</li>
              <li>{definition.referral.programLiabilityCapCopy}.</li>
              <li>
                The same person, same household, same payment identity, and an already-attributed
                recipient are denied. A fourth qualifying referral is denied.
              </li>
              <li>
                No cash payout, transfer, external action, or production activation is allowed.
              </li>
            </ul>
          </aside>
        </section>
      ) : null}
    </main>
  );
}
