# Carevelo

**White-label digital health software for Uganda's licensed private clinics.**

Carevelo gives an independent clinic its own branded digital front door — patient booking, teleconsultation, e-prescribing, dispensing handoff to the clinic's own pharmacy, delivery dispatch, and mobile-money collection — running under the clinic's own brand and, critically, under the clinic's own regulatory licences.

Carevelo is a **software supplier and data processor only**. It does not employ clinicians, does not hold or dispense drugs, and does not take custody of patient funds. Those three boundaries are what keep the platform outside UMDPC provider licensing, the National Drug Authority drug regime, and the National Payment Systems Act 2020 payment-service-provider category. They are enforced in the architecture, not merely stated in policy.

## Status

Pre-implementation. This repository currently contains the commercial and technical documentation that the system will be built from. No application code yet.

## Documentation

Start at **[docs/README.md](docs/README.md)** — it carries the index, the reading order for newcomers, and the documentation conventions.

Fast paths:

- Why this exists, commercially → [Business Plan](docs/00-overview/business-plan.md)
- What we are building → [Vision & Scope](docs/00-overview/vision-and-scope.md)
- What the words mean → [Glossary](docs/00-overview/glossary.md)
- How the system is shaped → [System Context](docs/30-architecture/system-context.md), [Multi-Tenancy](docs/30-architecture/multi-tenancy.md)
- Why money never touches us → [Payments Regulatory Boundary](docs/50-security-compliance/payments-regulatory-boundary.md)

## Stack

Laravel (PHP) API backend, Next.js (React) frontends, PostgreSQL with row-level security. See [ADR-0001](docs/70-decisions/0001-laravel-nextjs-stack.md).

## Licence

See [LICENSE](LICENSE).
