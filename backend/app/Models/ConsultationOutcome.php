<?php

namespace App\Models;

/** @see docs/10-product/prd-h3-teleconsultation.md */
enum ConsultationOutcome: string
{
    case Completed = 'completed';
    case PatientNoShow = 'patient_no_show';
    case ClinicianUnavailable = 'clinician_unavailable';

    /**
     * The clinician judged remote care unsafe.
     *
     * NO prescription may be issued on a consultation with this outcome. It is
     * a hard constraint, not a warning.
     */
    case ConvertedToInPerson = 'converted_to_in_person';

    case TechnicalFailure = 'technical_failure';

    public function permitsPrescribing(): bool
    {
        return $this === self::Completed;
    }
}
