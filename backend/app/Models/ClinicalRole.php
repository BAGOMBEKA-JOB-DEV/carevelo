<?php

namespace App\Models;

/**
 * The seven tenant roles and three platform roles.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */
enum ClinicalRole: string
{
    case ClinicAdmin = 'clinic_admin';
    case Clinician = 'clinician';
    case Pharmacist = 'pharmacist';
    case Dispatcher = 'dispatcher';
    case FrontDesk = 'front_desk';

    /** The most restricted role in the system. */
    case Rider = 'rider';

    case Patient = 'patient';

    case PlatformSupport = 'platform_support';
    case PlatformAdmin = 'platform_admin';

    /** Temporary, granted, time-boxed clinical access. */
    case BreakGlass = 'break_glass';

    /** @return list<self> */
    public static function tenantRoles(): array
    {
        return [
            self::ClinicAdmin, self::Clinician, self::Pharmacist,
            self::Dispatcher, self::FrontDesk, self::Rider, self::Patient,
        ];
    }

    /** @return list<self> */
    public static function platformRoles(): array
    {
        return [self::PlatformSupport, self::PlatformAdmin, self::BreakGlass];
    }

    /** Platform roles reach NO clinical data without a break-glass grant. */
    public function isPlatformRole(): bool
    {
        return in_array($this, self::platformRoles(), true);
    }
}
