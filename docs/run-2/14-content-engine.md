# 14 — Governed Content Engine

Status: **source, review, and claim-control metadata are implemented and persistence-tested; generation, media processing, publishing, and distribution do not exist**.

## Governance foundation

Run 2 adds provenance records for official, adjudicated-incident, founder-original, and partner sources. A source has a fingerprint, evidence state, capture time, optional freshness deadline, and creator. Governed items can represent scam pages, explainers, alerts, newsletters, social drafts, FAQs, video talking points, and founder derivatives. Each supported claim links to a source.

The approval policy fails closed when an item lacks verified evidence, depends on stale evidence, carries an `unsupported_statistics` or `unverified_urgency` flag, or has not reached an approval state. Founder derivatives can retain both their founder source and parent content item. The database prevents `published_at` unless review state is `approved`.

**Tested locally:** creation, evidence linkage, founder-approval routing, and approval of a current supported fixture. Unit tests also reject the policy conditions above. Evidence: [content rules](../../packages/business-os/src/acquisition.ts), [repository](../../packages/persistence/src/business-os.ts), [schema](../../packages/persistence/migrations/0005_run2_business_os.sql), and [persistence tests](../../packages/persistence/src/business-os.test.ts).

## Intended founder workflow

One founder-original recording may eventually produce an internal transcript, article draft, newsletter draft, short-clip plan, caption set, FAQ, partner talking points, and media-quote suggestions. Every derivative must retain the original source ID, transformation history, evidence links, and human approval state. It must never impersonate the founder or manufacture expertise, incidents, statistics, urgency, testimonials, or losses prevented.

Verified intelligence may support question-led pages such as “Is this USPS text a scam?” only when the claims are current and sourced. Templates should answer a real user question and provide safe action; they must not mass-produce thin SEO variants.

## What is not implemented

The current item stores governance metadata and a title, not an article body, transcript, audio, video, clip, or publishable asset. There is no transcription provider, model adapter, media store, editor, HQ content screen, publication API, CMS, scheduler, email sender, social account, search console, or outcome analytics. `published_at` is a constraint, not a publisher. No public content was generated or sent in Run 2.

The automation registry permits only an **internal draft** from public or already approved content. It does not permit publishing, founder impersonation, or novel safety advice. The global automation stop defaults engaged and there is no executor. See the [Automation Agents](./23-automation-agents.md) and [Autonomy Matrix](./AUTONOMY-MATRIX.md).

Run 3 needs a rights/retention policy for source media, professional review of claims and endorsements, an approved editorial rubric, human review assignments, provider data terms, and a reversible staging publisher. Effectiveness remains blocked until real, approved content receives measurable traffic without compromising safety or trust.
