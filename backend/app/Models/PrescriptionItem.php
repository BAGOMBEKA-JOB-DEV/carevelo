<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Database\Factories\PrescriptionItemFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $medicine_name
 * @property bool $is_controlled
 * @property ?string $form
 * @property ?string $strength
 * @property int $quantity
 * @property ?string $unit
 * @property string $directions
 */
class PrescriptionItem extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<PrescriptionItemFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'prescription_id', 'medicine_name', 'form', 'strength',
        'quantity', 'unit', 'directions', 'is_controlled',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'is_controlled' => 'boolean',
            'quantity' => 'integer',
        ];
    }
}
