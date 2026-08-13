<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $medicine_name_dispensed
 * @property bool $is_fulfilled
 * @property string $dispense_order_id
 * @property string $prescription_item_id
 * @property int $quantity_dispensed
 * @property int $unit_price_minor
 * @property string $currency
 * @property ?string $substitution_id
 * @property ?string $unfulfilled_reason
 */
class DispenseItem extends Model
{
    use BelongsToTenant;
    use HasUlids;

    protected $fillable = [
        'dispense_order_id', 'prescription_item_id', 'medicine_name_dispensed',
        'quantity_dispensed', 'unit_price_minor', 'currency',
        'substitution_id', 'is_fulfilled', 'unfulfilled_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'is_fulfilled' => 'boolean',
            'quantity_dispensed' => 'integer',
        ];
    }
}
