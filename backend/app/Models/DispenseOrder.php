<?php

namespace App\Models;

use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\Concerns\BelongsToTenant;
use App\Support\Money;
use Database\Factories\DispenseOrderFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Date;

/**
 * The pharmacy's work item, created from a prescription.
 *
 * A SEPARATE aggregate precisely so the prescription stays immutable. What was
 * PRESCRIBED and what was DISPENSED are different facts and both must be
 * recoverable. It is also what makes Phase 2 inventory addable without touching
 * clinical records.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
 *
 * @property string $id
 * @property string $reference
 * @property DispenseOrderStatus $status
 * @property Money $total
 */
class DispenseOrder extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<DispenseOrderFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'reference', 'prescription_id', 'patient_id', 'pharmacist_id',
        'fulfilment', 'subtotal_minor', 'delivery_fee_minor', 'total_minor',
        'currency', 'status', 'rejection_reason', 'dispensed_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => DispenseOrderStatus::class,
            'total' => Money::class,
            'dispensed_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Prescription, $this> */
    public function prescription(): BelongsTo
    {
        return $this->belongsTo(Prescription::class);
    }

    /** @return HasMany<Substitution, $this> */
    public function substitutions(): HasMany
    {
        return $this->hasMany(Substitution::class);
    }

    /** @return HasMany<DispenseItem, $this> */
    public function items(): HasMany
    {
        return $this->hasMany(DispenseItem::class);
    }

    public function hasPendingSubstitutions(): bool
    {
        return $this->substitutions()
            ->where('status', SubstitutionStatus::Pending)
            ->exists();
    }

    /**
     * Dispense, recorded against a NAMED pharmacist of the tenant.
     *
     * Carevelo never dispenses. Medicines are handed over by the clinic's own
     * NDA-licensed pharmacy staff under the NDPA Act Cap 206.
     */
    public function dispense(string $pharmacistId): void
    {
        if ($this->hasPendingSubstitutions()) {
            throw new IllegalTransition(
                'Cannot dispense while a substitution awaits clinician approval. '
                .'A substitution takes effect only on approval, and is never a '
                .'pharmacist\'s unilateral decision.'
            );
        }

        $this->status->assertCanTransitionTo(DispenseOrderStatus::Dispensed);

        $this->status = DispenseOrderStatus::Dispensed;
        $this->pharmacist_id = $pharmacistId;
        $this->dispensed_at = Date::now();
        $this->save();
    }

    /**
     * Whether this order may be delivered at all.
     *
     * Controlled items are flagged for in-person handling and are EXCLUDED
     * from the delivery flow entirely. There is deliberately no override --
     * the system does not offer the clinic a way around it.
     */
    public function mayBeDelivered(): bool
    {
        $prescription = $this->prescription()->firstOrFail();

        return ! $prescription->hasControlledItems();
    }

    public function transitionTo(DispenseOrderStatus $status): void
    {
        $this->status->assertCanTransitionTo($status);

        $this->status = $status;
        $this->save();
    }
}
