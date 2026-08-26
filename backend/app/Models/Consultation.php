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
 * @property ?string $patient_id
 * @property ?string $clinician_id
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
     * The chat transcript, oldest first.
     *
     * Alongside notes() rather than somewhere else, because it is the same
     * class of thing: clinical text authored inside this encounter. The
     * ordering is fixed here rather than left to each caller -- a transcript
     * read back in the wrong order is a different conversation. created_at
     * first, then id, because ULIDs sort lexicographically by generation time
     * and two messages sent inside the same second must still come back in the
     * order they were sent.
     *
     * @return HasMany<ConsultationMessage, $this>
     */
    public function messages(): HasMany
    {
        return $this->hasMany(ConsultationMessage::class)
            ->orderBy('created_at')
            ->orderBy('id');
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
