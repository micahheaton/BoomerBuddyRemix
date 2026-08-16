# ADR-0006: Never Fetch Submitted URLs in Build Run 1

Status: **Accepted; live acquisition deferred**

Decision date: 2026-08-15

## Context

User-submitted URLs are hostile and privacy-sensitive. Server retrieval creates SSRF, DNS rebinding, metadata-service, redirect, decompression, malware, active-content, and provider-disclosure risks. The narrow proof only needs deterministic string analysis.

## Decision

Build Run 1 validates and parses a URL string but never resolves DNS, requests it, follows redirects, previews it, renders it, or asks an embedded browser to open it. Network-denial tests instrument the Check path. Output may describe string structure only and must label page, domain-age, DNS, TLS, redirect, and live reputation evidence `unknown`/`unverified`.

Any future acquisition is a separately reviewed service/worker with no customer/control-plane credentials or primary-database route; deny-by-default egress; loopback, private, link-local, and metadata ranges rejected after every resolution; pinned destination; bounded method, redirects, time, bytes, decompression, and types; no cookies/ambient auth; disposable quarantine; malware/active-content controls; sanitized typed output; rate/cost limits; and full evaluation. Browser automation requires a stronger sandbox.

Commercial reputation lookup also needs privacy, license, retention, accuracy, cost, and failure-state review. Provider output is evidence, never a safe verdict.

## Consequences

Run 1 cannot verify the destination or current reputation, a limitation shown to users. It avoids an unnecessary high-risk network boundary. Later acquisition costs an isolated deployment and specialist review.

Rejected: backend `fetch`, client preview, URL unfurl SDK, headless browser in the API, and free Safe Browsing for commercial production.

## Evidence

Accessed 2026-08-15: [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), [Google Web Risk overview](https://cloud.google.com/web-risk/docs/overview), and [Google Safe Browsing terms](https://developers.google.com/safe-browsing/terms?hl=en).
