# Backup & Restore

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** [Disaster Recovery](../30-architecture/disaster-recovery.md), [Data Residency](../30-architecture/data-residency-and-hosting.md)

**An untested backup is a belief, not a backup.** The restore test is the part of this document that matters; everything else is configuration.

## Regime

| Property | Requirement |
|---|---|
| **Database** | Continuous WAL archiving + daily full backup |
| **Object storage** | Versioned, with cross-zone replication in region |
| **Point-in-time recovery** | 30 days |
| **Monthly archives** | 12 retained |
| **Location** | **In region** ([Data Residency](../30-architecture/data-residency-and-hosting.md)), separate storage from production |
| **Encryption** | Encrypted, **keys held separately from the backup store** |
| **Immutability** | Write-once. **Not deletable with production credentials** |
| **Verification** | **Restore-tested monthly** |

Two of these are load-bearing and easy to get wrong:

**Keys separate from the backup store.** A backup encrypted with a key stored beside it is not encrypted against anyone who reaches the store.

**Immutable and separately credentialed.** An attacker with production access must not be able to delete the backups. This single control is what separates a bad week from the end of the business ([Disaster Recovery](../30-architecture/disaster-recovery.md)).

## What is backed up

| Data | Method |
|---|---|
| PostgreSQL — all tenant and platform data | WAL + full |
| **Audit log** | Included. Immutable in the database *and* in backup |
| Object storage — prescription PDFs, logos | Versioned, replicated |
| Secrets | In the secret store's own backup, **never in the database backup** |
| Redis | Not backed up. Queue jobs are replayable; cache is disposable |
| Application logs | Retained on their own schedule, not part of recovery |

Redis is deliberately excluded. Losing queued jobs is survivable because payment resolution never depends on the queue alone — the scheduled reconciliation poll re-resolves anything lost ([Webhooks](../40-api/webhooks.md)).

## The monthly restore test

Scheduled work, not an aspiration. **A failed restore test is a production incident**, because it means we currently have no recovery capability.

1. Provision a scratch instance in region.
2. Restore the most recent full backup plus WAL to a chosen point in time.
3. Verify:
   - Row counts on key tables are plausible.
   - **RLS policies restored, enabled and forced.**
   - **The application role still cannot bypass RLS and does not own the tables.**
   - A sample tenant's data is complete and correctly isolated.
   - `audit_events` grants are intact — `INSERT`/`SELECT` only.
4. Record elapsed time. This is the real RTO, not the one in the plan.
5. Destroy the scratch instance and confirm destruction.

Steps 3's RLS checks exist because **restoring a database can silently restore the wrong ownership or grants**, producing a system that runs perfectly and protects nothing ([Threat Model](../50-security-compliance/threat-model.md)). A restore that loses RLS is not a successful restore.

## Restore procedures

### Full recovery
Follow [Disaster Recovery](../30-architecture/disaster-recovery.md). Restore, verify as above, cut over, confirm the isolation health check passes before accepting traffic.

### Point-in-time, after a bad migration or corruption
1. Identify the timestamp immediately before the event.
2. Restore to a **separate** instance — never over production.
3. Verify the data is as expected at that point.
4. Cut over, or extract and reconcile the specific affected data.

### Single-tenant recovery — the commonest real request
1. Restore to a scratch instance at the required point.
2. Extract that tenant's rows, in dependency order.
3. Reinsert into production within tenant context.
4. Audit the operation.

**Never restore the whole database to fix one tenant's mistake.** It would discard every other clinic's work since the restore point. If this is ever the only available option, the backup strategy is wrong.

### Object recovery
Restore the prior version from storage versioning. Prescription PDFs can also simply be **regenerated** — the prescription record lives in PostgreSQL and the PDF is a rendering of it, which is exactly why that separation exists ([Disaster Recovery](../30-architecture/disaster-recovery.md)).

## Access

Restoring a backup means access to every tenant's clinical data at once — the highest-privilege operation in the system.

- Backup credentials are separate from production credentials and held by the fewest people possible.
- **Every restore is audited**, with a recorded reason.
- A restore touching tenant clinical data follows the break-glass expectations: reason recorded, affected tenants notified where their data was accessed ([RBAC Matrix](../50-security-compliance/rbac-matrix.md)).
- Scratch instances are destroyed after use, and the destruction is confirmed rather than assumed.

## Monitoring

Alert on: a backup job failing, a backup older than expected, a restore test failing, backup storage approaching capacity, and any deletion attempt against the immutable store.

**A backup silently not running is the failure that only surfaces when it is too late to fix.** Treat a missed backup as an incident on the day it is missed.

## Retention and deletion

Backups age out on their own schedule. **They cannot be selectively edited**, which means a tenant's data persists in backups after live deletion — disclosed plainly at offboarding rather than glossed over ([Retention & Deletion](../50-security-compliance/data-retention-and-deletion.md)).

The honest statement to a departing clinic: *your data is gone from live systems now, and from backups within the backup retention window.*
