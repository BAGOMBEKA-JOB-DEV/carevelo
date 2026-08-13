# ADR-NNNN — Short decision title

> **Status:** Proposed | Accepted | Superseded by [ADR-NNNN](.) | Deprecated
> **Date:** YYYY-MM-DD
> **Deciders:** names
> **Derives from:** Business Plan §X (where applicable)

## Context

What forces this decision. The constraint, the problem, the regulatory pressure, the thing that will hurt if we choose wrong. State the facts, not the conclusion.

Cite sources — a business-plan section, a statute, a measurement. An ADR resting on an unstated assumption is unreviewable a year later, when the person reading it is a new engineer or an acquirer's technical reviewer.

## Options considered

### Option A — name
What it is. Honest advantages. Honest disadvantages.

### Option B — name
Same.

Include the option we rejected and why. **An ADR listing only the chosen option is a press release, not a decision record.** The rejected options are what make the decision reviewable when circumstances change.

## Decision

What we are doing, stated plainly and unambiguously.

## Consequences

**Accepted costs** — what becomes harder, slower or more expensive. Be honest; this section is what a future reader checks against reality.

**Benefits** — what becomes possible or safe.

**What this forecloses** — options this rules out, and how expensive reversal would be.

## Revisit when

The concrete trigger that would reopen this. A measurement, a regulatory event, a scale threshold.

An ADR with no revisit trigger is a decision nobody will ever dare to change, because nobody will know whether they are allowed to.

## Related

Links to the documents this decision governs.

---

## How we use ADRs

**Write one when** a decision is expensive to reverse, affects the regulatory position, constrains future work, or was contested. Not for reversible choices with obvious defaults.

**Numbering** is sequential and permanent. A superseded ADR is never deleted or edited — its status changes and it points at its successor. The history of a decision is often more useful than the decision.

**Architecture and compliance documents change by ADR**, not by silent edit ([docs/README.md](../README.md)). If a change alters a decision, write the ADR first and let the document reference it.
