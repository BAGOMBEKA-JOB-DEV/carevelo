<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Models\Concerns\ScopedToPatientOwner;
use App\Models\Contracts\RestrictableToPatient;
use Database\Factories\ConsultationFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Date;

/**
 * The clinical encounter itself.
 *
 * @property string $id
 * @property string $tenant_id
 * @property ConsultationMode $mode_used
 * @property ?ConsultationOutcome $outcome
 */
class Consultation extends Model implements RestrictableToPatient
{
    use BelongsToTenant;

    /** @use HasFactory<ConsultationFactory> */
    use HasFactory;

    use HasUlids;
    use ScopedToPatientOwner;

    protected $fillable = [
        'appointment_id', 'patient_id', 'clinician_id',
        'started_at', 'ended_at', 'mode_used', 'outcome',
    ];

    /**
     * started_at, ended_at are timestamptz.
     *
     * Laravel's default format is naive ('Y-m-d H:i:s'), so PostgreSQL resolves
     * the missing offset in the SESSION's timezone rather than the application's.
     * The instant stored then depends on how the database server happens to be
     * configured. What shifts here is the clinical record of when care was actually given, which is evidence in a UMDPC complaint.
     *
     * Columns declared without a timezone ignore the offset, so created_at and
     * updated_at are unaffected.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'mode_used' => ConsultationMode::class,
            'outcome' => ConsultationOutcome::class,
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
        ];
    }

    /** @return HasMany<ClinicalNote, $this> */
    public function notes(): HasMany
    {
        return $this->hasMany(ClinicalNote::class);
    }

    /**
     * Record a mode step-down truthfully.
     *
     * A video call that fell back to voice is recorded as voice. The truthful
     * record matters clinically, and it is the only honest measure of what
     * patients on Ugandan mobile data actually experience.
     */
    public function degradeTo(ConsultationMode $mode): void
    {
        $this->mode_used = $mode;
        $this->save();
    }

    public function end(ConsultationOutcome $outcome): void
    {
        $this->outcome = $outcome;
        $this->ended_at = Date::now();
        $this->save();
    }
}
