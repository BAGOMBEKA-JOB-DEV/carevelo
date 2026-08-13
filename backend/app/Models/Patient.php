<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Database\Factories\PatientFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A person receiving care from one tenant.
 *
 * A person attending two clinics is two Patient records in two tenants,
 * deliberately. There is no cross-tenant patient identity, and adding one would
 * breach the isolation boundary.
 *
 * @see docs/20-domain/domain-model.md
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $given_name
 * @property string $family_name
 * @property string $phone
 * @property PatientStatus $status
 * @property ?Carbon $phone_verified_at
 * @property ?string $email
 * @property ?string $sex
 * @property ?string $district
 * @property ?Carbon $date_of_birth
 */
class Patient extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<PatientFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'given_name',
        'family_name',
        'phone',
        'email',
        'date_of_birth',
        'sex',
        'national_id_number',
        'address',
        'district',
        'guardian_name',
        'guardian_phone',
        'guardian_relationship',
        'status',
        'phone_verified_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => PatientStatus::class,
            'date_of_birth' => 'date',
            'phone_verified_at' => 'datetime',
        ];
    }

    /**
     * No clinical data may attach to a patient in pending_consent.
     *
     * @see docs/10-product/prd-h2-patient-registration-consent.md
     */
    public function mayHoldClinicalData(): bool
    {
        return $this->status === PatientStatus::Active;
    }
}
