<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

/**
 * A tenant's own credentials at a BoU-licensed aggregator.
 *
 * THE CLINIC'S OWN account, not ours. Every collection call uses these
 * credentials, and funds settle directly to the clinic. There is no
 * platform-level merchant account, because there is no platform account for
 * funds to reach.
 *
 * Secrets are encrypted at rest, hidden from serialisation, and must never be
 * returned by any API or written to any log -- including exception traces,
 * which is where they most often escape.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 *
 * @property string $id
 * @property string $provider
 * @property string $status
 */
class AggregatorAccount extends Model
{
    use BelongsToTenant;
    use HasUlids;

    protected $fillable = [
        'provider', 'public_key', 'secret_key', 'webhook_secret',
        'merchant_reference', 'environment', 'status', 'last_verified_at',
    ];

    /**
     * Write-only. Nobody can read these back -- not the administrator who
     * entered them, and not Carevelo.
     *
     * @var list<string>
     */
    protected $hidden = ['secret_key', 'webhook_secret', 'public_key'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            // Laravel's encrypted cast: envelope encryption at rest, so a
            // leaked database backup does not hand over a clinic's merchant
            // credentials.
            'secret_key' => 'encrypted',
            'webhook_secret' => 'encrypted',
            'last_verified_at' => 'datetime',
        ];
    }

    public function isUsable(): bool
    {
        return $this->status === 'active' && $this->secret_key !== null;
    }
}
