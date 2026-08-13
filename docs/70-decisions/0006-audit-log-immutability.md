# ADR-0006 — Append-only audit log enforced by database grants

> **Status:** Accepted
> **Date:** 2026-08-13
> **Derives from:** Business Plan §H7.3, §I

## Context

The audit log is the evidence layer. It answers three questions we cannot answer any other way:

- **The PDPO or a patient:** what did this person consent to, and when? DPPA 2019 requires consent to be *demonstrable*.
- **A clinic:** who read this patient's record?
- **Us, during an incident:** was data **accessed**, or merely **exposed**? That distinction changes the notification entirely ([Incident Response](../50-security-compliance/incident-response.md)).

An audit log an attacker can edit answers none of them. And the realistic compromise scenario — a vulnerability giving code execution in our application, or a compromised dependency ([Threat Model](../50-security-compliance/threat-model.md)) — is precisely the scenario where an attacker would want to edit it.

## Options considered

### A. Ordinary table, application-enforced

Write events, and simply do not build an update or delete path.

**Against:** the application *can* modify them, so anything running as the application can. A compromised dependency, an SQL injection, or a well-meaning "cleanup" migration all defeat it. The protection is a convention, and conventions do not survive an adversary.

### B. Append-only enforced by database grants — chosen

Revoke `UPDATE` and `DELETE` from the application role. The application physically cannot modify an audit event, whatever the code says.

```sql
REVOKE UPDATE, DELETE ON audit_events FROM carevelo_app;
GRANT  INSERT, SELECT ON audit_events TO   carevelo_app;
```

**Against:** archival and retention need a separate, separately-credentialed process. Correcting a genuinely wrong event is impossible — which is the intended behaviour, and corrections are made by appending a correcting event.

### C. Cryptographic chaining — hash-linked events

Each event includes a hash of its predecessor, making tampering detectable.

**For:** detects tampering even by someone with database privileges.

**Against:** meaningful complexity for a threat we do not currently face — an attacker with direct database credentials, at which point the incident is total anyway. Chain verification and repair after legitimate archival is fiddly. **Worth revisiting; not worth building first.**

### D. External append-only service

Ship events to a managed immutable store.

**Against:** cross-border transfer of audit data (§I, [Data Residency](../30-architecture/data-residency-and-hosting.md)); an external dependency in the write path; cost; and an audit log that can be lost when the vendor relationship ends.

## Decision

**Append-only, enforced by PostgreSQL grants.** Option B.

- Application role: `INSERT` and `SELECT` only.
- **No role in the application can update or delete an audit event** — including every platform role ([RBAC Matrix](../50-security-compliance/rbac-matrix.md)).
- Events are written **in the same transaction** as the domain operation, so if the action succeeded the event exists.
- Archival runs under a separate, separately-credentialed process.
- Verified in CI **and** at boot, since a grant silently restored is a silent loss of the control.

Full specification in [Audit Logging](../50-security-compliance/audit-logging.md).

## Consequences

**Accepted costs.**

- A wrong event cannot be corrected, only appended to. Correct by design.
- Archival requires separate credentials and a separate process — a small operational cost, and one worth paying.
- Volume grows steadily, dominated by clinical-record reads. Mitigated by monthly partitioning and cold-storage archival.
- Every domain operation carries an extra insert. Cheap: the event stores identifiers and outcomes, never serialised payloads.
- **The audit log must not itself become a health-data breach.** It is queried by administrators, exported, and retained longer than most data — hence the strict rule that it records *that* something happened to *which* record, never *what* the record said.

**Benefits.**

- **An attacker with application-level code execution cannot cover their tracks.** This is the property that makes incident scoping possible at all.
- Consent evidence is genuinely evidential — immutable, timestamped, with the hash of the exact text shown.
- Access history is trustworthy, so "was it accessed or merely exposed?" has a real answer.
- Break-glass usage is provable to the affected clinic.

**Forecloses.** Bulk correction of historical events, which we do not want. Direct deletion for retention — handled by the separate archival process instead.

## Revisit when

- **A threat model update includes an adversary with direct database credentials.** Then option C — cryptographic chaining — becomes worth its complexity.
- Volume makes partitioning and archival insufficient. Unlikely at Phase 3 scale.
- A regulation requires externally-verifiable audit evidence.

## Related

[Audit Logging](../50-security-compliance/audit-logging.md) · [Threat Model](../50-security-compliance/threat-model.md) · [Incident Response](../50-security-compliance/incident-response.md) · [ADR-0002](0002-postgresql-rls-shared-schema-tenancy.md)
