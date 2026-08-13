# System Context

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §H; [Personas & Actors](../00-overview/personas-and-actors.md)

C4 levels 1 and 2. Level 3 lives in [Backend](backend-laravel.md) and [Frontend](frontend-nextjs.md).

## Level 1 — System context

```mermaid
graph TB
    Patient([Patient])
    Staff([Clinic staff<br/>admin, clinician, pharmacist,<br/>dispatcher, rider])
    Operator([Carevelo operator])

    Carevelo["<b>Carevelo</b><br/>White-label digital health platform<br/>Multi-tenant SaaS"]

    Aggregator["Payment Aggregator<br/>Flutterwave / Pesapal<br/><i>BoU PSO-licensed</i>"]
    ClinicAccount[("Clinic's own<br/>MoMo / bank account")]
    SMSGw["SMS Gateway"]
    WA["WhatsApp Business API"]
    Video["Video / Realtime provider"]

    Patient -->|books, consults,<br/>pays, tracks| Carevelo
    Staff -->|manages, consults,<br/>dispenses, delivers| Carevelo
    Operator -->|administers<br/>no clinical access by default| Carevelo

    Carevelo -->|initiates collection using<br/>the CLINIC's credentials| Aggregator
    Aggregator ==>|settles funds directly| ClinicAccount
    Patient -->|pays| Aggregator

    Carevelo -->|non-clinical<br/>notifications| SMSGw
    Carevelo -->|non-clinical<br/>notifications| WA
    Carevelo -->|consultation media| Video

    SMSGw -.-> Patient
    Video -.-> Patient
    Video -.-> Staff

    style Carevelo fill:#1f6f5c,stroke:#0d3d33,color:#fff
    style ClinicAccount fill:#7a5c1f,stroke:#4a3610,color:#fff
```

Two features of this diagram are the whole architecture:

**Money never enters the Carevelo box.** The heavy line runs aggregator → clinic account. Carevelo initiates a collection using the clinic's own credentials and then records what happened. See [Payments Regulatory Boundary](../50-security-compliance/payments-regulatory-boundary.md).

**Clinical data never leaves it except to the people treating the patient.** SMS and WhatsApp carry no clinical content ([Notifications](../10-product/notifications-sms-whatsapp.md)); video media is transient and unrecorded.

## Level 2 — Containers

```mermaid
graph TB
    subgraph Clients
        PP["Patient Portal<br/><i>Next.js</i><br/>clinic-branded"]
        CC["Clinic Console<br/><i>Next.js</i><br/>staff"]
        PA["Platform Admin<br/><i>Next.js</i><br/>Carevelo staff"]
    end

    subgraph Platform["Carevelo Platform"]
        API["API<br/><i>Laravel</i><br/>modular monolith"]
        Worker["Queue Workers<br/><i>Laravel Horizon</i>"]
        Sched["Scheduler<br/><i>Laravel</i>"]
        DB[("PostgreSQL<br/><i>RLS-enforced<br/>tenant isolation</i>")]
        Redis[("Redis<br/>queue, cache,<br/>tenant-namespaced")]
        Obj[("Object Storage<br/>tenant-partitioned<br/>PDFs, logos")]
    end

    Ext["External services<br/>Aggregators · SMS · WhatsApp · Video"]

    PP --> API
    CC --> API
    PA --> API

    API --> DB
    API --> Redis
    API --> Obj
    API -.->|dispatch| Redis

    Redis --> Worker
    Worker --> DB
    Worker --> Obj
    Worker --> Ext
    Sched --> Redis

    API --> Ext
    Ext -->|webhooks| API

    style DB fill:#1f4f6f,stroke:#0d2c3d,color:#fff
    style API fill:#1f6f5c,stroke:#0d3d33,color:#fff
```

| Container | Technology | Responsibility |
|---|---|---|
| **Patient Portal** | Next.js | Clinic-branded booking, consultation, prescriptions, payment, delivery tracking. Tenant resolved by subdomain |
| **Clinic Console** | Next.js | Staff surfaces: schedule, consultations, pharmacy queue, dispatch, administration, reconciliation |
| **Platform Admin** | Next.js | Tenant register, subscriptions, system health. No clinical data without break-glass |
| **API** | Laravel, PHP 8.3+ | All business logic. Modular monolith ([ADR-0005](../70-decisions/0005-modular-monolith-over-microservices.md)) |
| **Queue Workers** | Laravel Horizon | Notifications, PDF rendering, reconciliation polls, webhook processing. Every job restores tenant context |
| **Scheduler** | Laravel | Reminders, reconciliation sweeps, retention jobs |
| **PostgreSQL** | 16+ | Single database, shared schema, RLS-enforced isolation ([Multi-Tenancy](multi-tenancy.md)) |
| **Redis** | 7+ | Queue backend, cache, rate limiting. Keys namespaced per tenant |
| **Object Storage** | S3-compatible | Prescription PDFs, logos, attachments. Tenant-partitioned, signed URLs only |

Deliberately simple: one API, one database, one queue. A solo or two-person team cannot operate a distributed system, and §M identifies founder capacity as a top-three risk — the architecture is a response to that constraint as much as to the technical requirements.

## Trust boundaries

```mermaid
graph LR
    subgraph Internet["Untrusted"]
        B1[Patient browser]
        B2[Staff browser]
    end
    subgraph Edge["Edge — TLS, WAF, rate limit"]
        E[Reverse proxy]
    end
    subgraph App["Application — authenticated, tenant-scoped"]
        A[Laravel API]
    end
    subgraph Data["Data — RLS enforced"]
        D[(PostgreSQL)]
    end
    subgraph External["External — licensed third parties"]
        X[Aggregators · SMS · Video]
    end

    B1 --> E --> A --> D
    B2 --> E
    A <--> X
```

| Boundary | Control |
|---|---|
| Internet → Edge | TLS 1.2+, HSTS, rate limiting, WAF |
| Edge → API | Authentication (Sanctum), tenant resolution, authorisation ([Auth](../40-api/authentication-and-sessions.md)) |
| API → Database | **RLS.** The application role is subject to it and cannot bypass it |
| API ↔ External | Per-tenant credentials, signature-verified webhooks, outbound allow-list |
| Operator → Tenant data | Break-glass only: time-boxed, audited, tenant-notified |

Full analysis in [Threat Model](../50-security-compliance/threat-model.md).

## Data flows worth tracing

**Payment (H5).** Patient → API → aggregator *with the tenant's credentials* → aggregator pushes to the patient's handset → funds settle to the clinic → aggregator webhook → API records the outcome. A scheduled poll backstops the webhook. Carevelo is never in the funds path.

**Prescription (H3 → H4).** Clinician issues within a consultation → PDF rendered asynchronously to tenant-partitioned storage → `DispenseOrder` created in the same tenant → pharmacy queue → dispensing → optional delivery. The prescription is never mutated; the dispense order carries everything the pharmacy does.

**Notification.** Domain event → queued job restoring tenant context → template rendered with clinic branding → SMS gateway. **No clinical content crosses this boundary** ([Notifications](../10-product/notifications-sms-whatsapp.md)).

**Consultation media.** Browser ↔ video provider, peer-to-peer or relayed. Media does not traverse the Laravel API and is not recorded. Only metadata — start, end, mode used — is persisted ([Realtime & Video](realtime-and-video.md)).

## Deployment shape

Single region, Ugandan or African, for data residency (§I) — see [Data Residency](data-residency-and-hosting.md).

```mermaid
graph TB
    CDN[CDN / edge<br/>static assets only] --> LB[Load balancer<br/>TLS termination]
    LB --> Web1[Next.js instances]
    LB --> Api1[Laravel API instances]
    Api1 --> PG[(PostgreSQL primary)]
    PG --> PGR[("Read replica / standby")]
    Api1 --> RD[(Redis)]
    RD --> W[Horizon workers]
    Api1 --> S3[(Object storage)]
```

Details in [Environments & Deployment](environments-and-deployment.md); recovery objectives in [Disaster Recovery](disaster-recovery.md).
