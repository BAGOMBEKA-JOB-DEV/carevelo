<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * An immutable record that a patient granted or withdrew consent.
 *
 * WITHDRAWAL IS A NEW RECORD, NEVER AN UPDATE. The history of consent
 * decisions is itself the evidence: under DPPA 2019 consent must be
 * DEMONSTRABLE, and the policy version plus text hash are what let us
 * reconstruct months later exactly what someone agreed to.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $consent_type
 * @property string $action
 */
class ConsentRecord extends Model
{
    use BelongsToTenant;
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'patient_id', 'consent_type', 'policy_version', 'policy_text_hash',
        'action', 'granted_by', 'guardian_name', 'guardian_relationship',
        'occurred_at', 'ip_address', 'user_agent',
    ];

    protected static function booted(): void
    {
        static::updating(function (): never {
            throw new LogicException(
                'Consent records are immutable. Withdrawal is a new record, never an update.'
            );
        });

        static::deleting(function (): never {
            throw new LogicException(
                'Consent records are never deleted while the record they concern exists.'
            );
        });
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['occurred_at' => 'datetime'];
    }
}
