<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Database\Factories\ClinicianFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A registered practitioner engaged by the tenant.
 *
 * A Clinician always belongs to a tenant. THERE IS NO PLATFORM-LEVEL
 * CLINICIAN, because Carevelo never employs or contracts clinicians -- doing
 * so would make it a healthcare provider subject to UMDPC facility licensing
 * and liable for clinical outcomes.
 *
 * @see docs/10-product/non-goals.md
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $registration_number
 * @property bool $can_prescribe
 * @property ?Carbon $practising_licence_expires_at
 */
class Clinician extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<ClinicianFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'user_id', 'registration_body', 'registration_number',
        'practising_licence_expires_at', 'specialty', 'can_prescribe',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'can_prescribe' => 'boolean',
            'practising_licence_expires_at' => 'date',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Whether this clinician may issue a prescription.
     *
     * The single most important check in the system: it is what keeps the
     * platform a recorder rather than an issuer.
     */
    public function mayPrescribe(): bool
    {
        return $this->can_prescribe && trim($this->registration_number) !== '';
    }

    /**
     * An expired practising licence WARNS but does not block.
     *
     * Licence currency is the clinic's regulatory responsibility, not ours.
     * Blocking care on our possibly-stale copy would be the worse error.
     */
    public function hasExpiredLicence(): bool
    {
        return $this->practising_licence_expires_at !== null
            && $this->practising_licence_expires_at->isPast();
    }
}
