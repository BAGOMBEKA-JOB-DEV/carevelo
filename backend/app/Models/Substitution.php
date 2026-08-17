<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Database\Factories\SubstitutionFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;

/**
 * A pharmacist's proposal to dispense a different item from the one prescribed.
 *
 * Requires CLINICIAN re-approval before it takes effect. It is a first-class,
 * auditable event, not an edit to the prescription -- and never a pharmacist's
 * unilateral decision.
 *
 * A pending substitution blocks only its own item; the rest of the order
 * proceeds. Otherwise one out-of-stock item stalls everything, and pharmacists
 * work around the system rather than with it.
 *
 * @property string $id
 * @property string $tenant_id
 * @property SubstitutionStatus $status
 * @property string $dispense_order_id
 * @property string $prescription_item_id
 * @property string $proposed_medicine_name
 * @property string $reason
 * @property string $proposed_by
 * @property ?Carbon $proposed_at
 * @property ?string $decided_by
 * @property ?Carbon $decided_at
 */
class Substitution extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<SubstitutionFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'dispense_order_id', 'prescription_item_id', 'proposed_medicine_name',
        'reason', 'proposed_by', 'proposed_at', 'status', 'decided_by', 'decided_at',
    ];

    /**
     * proposed_at, decided_at are timestamptz.
     *
     * Laravel's default format is naive ('Y-m-d H:i:s'), so PostgreSQL resolves
     * the missing offset in the SESSION's timezone rather than the application's.
     * The instant stored then depends on how the database server happens to be
     * configured. What shifts here is proof the clinician approved the substitution before, not after, the medicine was handed over.
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
            'status' => SubstitutionStatus::class,
            'proposed_at' => 'datetime',
            'decided_at' => 'datetime',
        ];
    }

    /** Approve. Only a clinician may call this -- enforced by policy. */
    public function approve(string $clinicianId): void
    {
        $this->decide(SubstitutionStatus::Approved, $clinicianId);
    }

    public function reject(string $clinicianId): void
    {
        $this->decide(SubstitutionStatus::Rejected, $clinicianId);
    }

    protected function decide(SubstitutionStatus $status, string $clinicianId): void
    {
        $this->status->assertCanTransitionTo($status);

        $this->status = $status;
        $this->decided_by = $clinicianId;
        $this->decided_at = Date::now();
        $this->save();
    }
}
