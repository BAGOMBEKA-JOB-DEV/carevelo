<?php

namespace App\Models;

use Database\Factories\TenantFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A clinic.
 *
 * The unit of isolation, branding, subscription and support.
 *
 * Platform-scoped: this is the tenant register itself, so it carries no
 * tenant_id and is not subject to row-level security. It is one of the few
 * tables in that category — see the allow-list in the schema conformance test.
 *
 * @see docs/20-domain/domain-model.md
 *
 * @property string $id
 * @property string $slug
 * @property string $subdomain
 * @property string $legal_name
 * @property TenantStatus $status
 * @property ?Carbon $trial_ends_at
 */
class Tenant extends Model
{
    /** @use HasFactory<TenantFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'slug',
        'legal_name',
        'trading_name',
        'subdomain',
        'custom_domain',
        'primary_colour',
        'secondary_colour',
        'logo_path',
        'contact_phone',
        'contact_email',
        'physical_address',
        'district',
        'umdpc_facility_reference',
        'nda_licence_reference',
        'status',
        'timezone',
        'currency',
        'trial_ends_at',
    ];

    /**
     * Subdomains that must never be claimed by a clinic.
     *
     * @var list<string>
     */
    public const RESERVED_SLUGS = [
        'www', 'api', 'app', 'admin', 'docs', 'status', 'mail', 'help',
        'support', 'billing', 'static', 'assets', 'cdn', 'reverb',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => TenantStatus::class,
            'trial_ends_at' => 'datetime',
        ];
    }

    public function isActive(): bool
    {
        return $this->status === TenantStatus::Active;
    }
}
