<?php

namespace App\Models;

use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\Concerns\BelongsToTenant;
use Database\Factories\PrescriptionFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Date;
use LogicException;

/**
 * A clinical document issued BY A CLINICIAN.
 *
 * Immutable once issued. Correcting it means cancelling and issuing a
 * replacement that references the original -- the PDF has left the building and
 * may already be on someone's phone; pretending otherwise is dishonest.
 *
 * Carevelo does not issue prescriptions. It renders and stores what the
 * clinician decided, and the clinician's identity is snapshotted so the
 * historical document survives them leaving the tenant.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md
 *
 * @property string $id
 * @property string $tenant_id
 * @property PrescriptionStatus $status
 * @property string $clinician_registration_snapshot
 */
class Prescription extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<PrescriptionFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'consultation_id', 'clinician_id', 'patient_id',
        'clinician_name_snapshot', 'clinician_registration_snapshot',
        'registration_body_snapshot', 'issued_at', 'status',
        'supersedes_prescription_id', 'document_path', 'document_hash',
    ];

    /** Immutable except for the status transitions defined below. */
    protected static function booted(): void
    {
        static::updating(function (Prescription $prescription): void {
            $mutable = ['status', 'cancellation_reason', 'document_path', 'document_hash', 'updated_at'];

            $illegal = array_diff(array_keys($prescription->getDirty()), $mutable);

            if ($illegal !== []) {
                throw new LogicException(sprintf(
                    'Prescriptions are immutable after issue; cannot change [%s]. '
                    .'Cancel and issue a replacement instead.',
                    implode(', ', $illegal)
                ));
            }
        });
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => PrescriptionStatus::class,
            'issued_at' => 'datetime',
        ];
    }

    /** @return HasMany<PrescriptionItem, $this> */
    public function items(): HasMany
    {
        return $this->hasMany(PrescriptionItem::class);
    }

    /**
     * Issue a prescription.
     *
     * Two HARD preconditions, enforced rather than warned:
     *   1. the clinician may prescribe and holds a registration number
     *   2. the consultation did not end as converted_to_in_person
     *
     * @param  array<int, array<string, mixed>>  $items
     */
    public static function issue(Consultation $consultation, Clinician $clinician, array $items): self
    {
        if (! $clinician->mayPrescribe()) {
            throw new IllegalTransition(
                'This clinician cannot prescribe: prescribing requires can_prescribe '
                .'and a registration number. The prescription is a clinical act by a '
                .'licensed clinician of the clinic.'
            );
        }

        if ($consultation->outcome?->permitsPrescribing() !== true) {
            throw new IllegalTransition(
                'No prescription may be issued on a consultation that did not complete. '
                .'Where the clinician judged remote care unsafe, the patient is referred '
                .'in person instead.'
            );
        }

        $prescription = static::create([
            'consultation_id' => $consultation->id,
            'clinician_id' => $clinician->id,
            'patient_id' => $consultation->patient_id,
            'clinician_name_snapshot' => $clinician->user()->firstOrFail()->name,
            'clinician_registration_snapshot' => $clinician->registration_number,
            'registration_body_snapshot' => $clinician->registration_body,
            'issued_at' => Date::now(),
            'status' => PrescriptionStatus::Issued,
        ]);

        foreach ($items as $item) {
            $prescription->items()->create($item);
        }

        return $prescription;
    }

    public function cancel(string $reason): void
    {
        $this->status->assertCanTransitionTo(PrescriptionStatus::Cancelled);

        $this->status = PrescriptionStatus::Cancelled;
        $this->cancellation_reason = $reason;
        $this->save();
    }

    /** Whether any item requires in-person handling under NDPA Act Cap 206. */
    public function hasControlledItems(): bool
    {
        return $this->items()->where('is_controlled', true)->exists();
    }
}
