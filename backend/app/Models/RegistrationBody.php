<?php

namespace App\Models;

/**
 * The three Ugandan registers a clinician can be on.
 *
 * CAPTURED, NEVER VERIFIED. Carevelo has no access to the UMDPC, AHPC or Nurses
 * & Midwives registers and no API exists to check one against, so the value a
 * clinic records is its own attestation and every surface showing it must say
 * so. Automated licence verification is explicitly out of scope for H1, because
 * implying a check we never performed would be worse than recording an
 * attestation honestly.
 *
 * The COLUMN is deliberately not cast to this enum. `registration_body` is
 * snapshotted onto a prescription at the moment of issue, and that snapshot is
 * part of a document a clinic may have to produce years later -- it has to
 * reproduce exactly what was recorded, including rows written before this enum
 * existed and rows written in a different case. So the enum guards the WAY IN,
 * at validation, and reads stay plain strings.
 *
 * @see docs/20-domain/domain-model.md
 * @see docs/10-product/prd-h1-clinic-onboarding.md sections 3 and 6
 */
enum RegistrationBody: string
{
    /** Uganda Medical and Dental Practitioners Council. */
    case Umdpc = 'umdpc';

    /** Allied Health Professionals Council. */
    case Ahpc = 'ahpc';

    /** Uganda Nurses and Midwives Council. */
    case NursesMidwives = 'nurses_midwives';
}
