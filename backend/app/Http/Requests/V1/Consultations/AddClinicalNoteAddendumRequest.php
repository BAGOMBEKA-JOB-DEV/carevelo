<?php

namespace App\Http\Requests\V1\Consultations;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Correcting a clinical note.
 *
 * There is no field here for the note being corrected, because nothing about
 * it changes. The body supplied is the body of a NEW note of type `addendum`
 * that points back at the original; the original stays exactly as it was
 * written. A medical record that can be silently rewritten is not a medical
 * record.
 *
 * @see docs/20-domain/domain-model.md
 */
class AddClinicalNoteAddendumRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'max:20000'],
        ];
    }
}
