# Production Platform

Status: **architecture selected as a replaceable provider hypothesis; deployment is scaffolded and external proof is blocked**.

## Selected topology

| Capability | Initial hypothesis | Current evidence |
| --- | --- | --- |
| Customer web / HQ | Separate Vercel projects | Next.js apps and `vercel.json` files build locally; no Vercel projects |
| API / worker | Separate Render services | OCI build definition and `render.yaml` scaffold; no image/deploy proof |
| Database | Neon PostgreSQL | Standard `pg` adapter and forward SQL; no Neon account or restore |
| Identity | Clerk or independently reviewed alternative | Adapter decision only; local dev issuer remains |
| DNS | Cloudflare, founder controlled | No zone, registrar, or cutover proof |
| Objects | Reviewed S3-compatible service | Interface/retention decision only; no provider implementation |
| Operations | Sentry, PostHog, Postmark, Twilio | Not connected; no production data sent |
| Mobile | Expo/EAS and LLC-owned stores | Preview configuration only; no signed device/store build |

Stripe is the web-commerce hypothesis; Apple and Google are mobile-commerce sources above the same canonical entitlement model.

## Portability contract

**Implemented:** npm workspaces on Node 22, standard PostgreSQL/PGlite drivers, environment validation, a container build definition for API/worker artifacts, separate customer/HQ origins, health endpoints, forward migrations, and provider-neutral domain records. `scripts/verify-portability.mjs` passed locally.

**Not implemented:** managed identity, KMS/secret rotation, S3 object storage, production telemetry, transactional messaging, managed backups, restore automation, or production network controls. No Kubernetes or unnecessary microservice layer was introduced.

## Deployment truth

`render.yaml` sets `NODE_ENV=production`, while `packages/config/src/index.ts` deliberately rejects all production startup until managed identity and KMS controls exist. Therefore the blueprint is a useful topology scaffold, **not a startable production deployment**. Real PostgreSQL verification is configured in GitHub Actions but was not run on this local host. No vendor account, domain, production credential, or paid resource was provisioned.

See [ADR-0015](../adr/0015-portable-platform-and-replit-continuity.md). **Launch decision: no launch.**
