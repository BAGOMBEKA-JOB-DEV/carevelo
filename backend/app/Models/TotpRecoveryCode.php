<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One recovery code, stored as a digest and spendable once.
 *
 * WHAT IS IN THIS TABLE IS NOT A CODE. It is a SHA-256 digest of one, and there
 * is no path back: an operator who loses the sheet of codes they were shown at
 * enrolment does not recover them from here, from a backup, or from us. They
 * enrol again. That is the same discipline the aggregator credentials are held
 * to -- write-only, never readable, never logged -- and for the same reason: a
 * value that can be read out of a table is a value that leaves in a database
 * dump.
 *
 * SPENT RATHER THAN DELETED. `used_at` is set and the row stays, which is what
 * makes "a recovery code works exactly once" provable after the fact rather than
 * merely true: a deleted row and a row that never existed look identical to
 * anyone reading the table afterwards, and this is the mechanism that bypasses
 * the second factor.
 *
 * @see docs/40-api/authentication-and-sessions.md § Second factor
 *
 * @property string $id
 * @property string $user_id
 * @property string $code_hash
 * @property ?Carbon $used_at
 */
class TotpRecoveryCode extends Model
{
    use HasUlids;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'user_id',
        'code_hash',
    ];

    /**
     * Hidden from every array and JSON cast of this model.
     *
     * Belt and braces: no resource serialises this model and none should. But a
     * digest of a live credential appearing in a debug dump or a `toArray()`
     * somebody added later is exactly the accident this list exists to survive.
     *
     * @var list<string>
     */
    protected $hidden = [
        'code_hash',
    ];

    /**
     * `used_at` is timestamptz.
     *
     * Laravel's default 'Y-m-d H:i:s' carries no offset, so PostgreSQL resolves
     * the wall time in the SESSION's timezone and the instant actually stored
     * depends on how the database server happens to be configured.
     * SchemaConformanceTest asserts this on every model with a timestamptz column.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'used_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isSpent(): bool
    {
        return $this->used_at !== null;
    }
}
