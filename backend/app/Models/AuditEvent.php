<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * An append-only record of a security or privacy relevant action.
 *
 * Never updated. Never deleted. Enforced by database grants, not by this class
 * — the guards below only produce a clearer error than PostgreSQL would.
 *
 * @see docs/50-security-compliance/audit-logging.md
 * @see docs/70-decisions/0006-audit-log-immutability.md
 *
 * @property string $id
 * @property ?string $tenant_id
 * @property string $actor_type
 * @property ?string $actor_id
 * @property ?string $actor_role
 * @property string $action
 * @property ?string $subject_type
 * @property ?string $subject_id
 * @property Carbon $occurred_at
 * @property ?string $ip_address
 * @property ?string $user_agent
 * @property ?string $request_id
 * @property ?array<string, mixed> $metadata
 */
class AuditEvent extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'tenant_id',
        'actor_type',
        'actor_id',
        'actor_role',
        'action',
        'subject_type',
        'subject_id',
        'occurred_at',
        'ip_address',
        'user_agent',
        'request_id',
        'metadata',
    ];

    protected static function booted(): void
    {
        static::updating(function (): never {
            throw new LogicException(
                'Audit events are append-only. Correct by appending a new event, never by editing.'
            );
        });

        static::deleting(function (): never {
            throw new LogicException(
                'Audit events are append-only. Retention is handled by a separately credentialed archival process.'
            );
        });
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'occurred_at' => 'datetime',
            'metadata' => 'array',
        ];
    }
}
