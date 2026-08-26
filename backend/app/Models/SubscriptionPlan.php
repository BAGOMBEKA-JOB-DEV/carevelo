<?php

namespace App\Models;

/**
 * The published subscription tiers.
 *
 * A closed list rather than a string column with a hopeful name, because `plan`
 * is reported on, filtered by and compared: free text would make all three
 * meaningless within a month of the first bespoke deal.
 *
 * NOTE WHAT IS NOT HERE: THE PRICE. Early plans in this market are agreed in
 * conversation (Business Plan SS-G), and a clinic that negotiated a price keeps
 * it. The amount lives on the tenant, so a change to a published price list can
 * never silently re-price an existing clinic retroactively -- which a price
 * table here would do, with nothing in the diff to show it.
 *
 * So a tier says what a clinic GETS and the tenant says what it PAYS, and the
 * two are permitted to disagree. That is not an accident of modelling; it is how
 * the commercial relationship actually works.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md
 * @see docs/20-domain/domain-model.md
 */
enum SubscriptionPlan: string
{
    /** A single-clinician practice. */
    case Starter = 'starter';

    /** The ordinary case: one clinic, several clinicians, a dispensary. */
    case Clinic = 'clinic';

    /** Several sites under one owner, each still its own tenant. */
    case Group = 'group';
}
