<?php

namespace App\Http\Requests\V1\Consultations;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\ConsultationMode;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Recording the mode a consultation is actually being conducted in.
 *
 * Any of the three remote modes is accepted, in either direction: the state
 * machine allows conditions to improve as well as degrade, and a record that
 * only admits degradation would be no more truthful than one that admits
 * neither.
 *
 * `in_person` is deliberately not accepted. A remote consultation does not
 * become an in-person one by changing a field -- that is the
 * `converted_to_in_person` outcome, which also forbids prescribing.
 *
 * @see docs/20-domain/state-machines.md
 */
class RecordModeRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string|Enum>>
     */
    public function rules(): array
    {
        return [
            'mode' => [
                'required',
                Rule::enum(ConsultationMode::class)->except(ConsultationMode::InPerson),
            ],
        ];
    }
}
