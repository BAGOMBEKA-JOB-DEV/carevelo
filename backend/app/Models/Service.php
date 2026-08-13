<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Support\Money;
use Database\Factories\ServiceFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A bookable offering. Prices are per-tenant; there is no platform price list.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $name
 * @property Money $price
 * @property bool $is_active
 */
class Service extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<ServiceFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'name', 'description', 'duration_minutes',
        'price_minor', 'currency', 'modes', 'eligible_roles', 'is_active',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'price' => Money::class,
            'modes' => 'array',
            'eligible_roles' => 'array',
            'is_active' => 'boolean',
            'duration_minutes' => 'integer',
        ];
    }
}
