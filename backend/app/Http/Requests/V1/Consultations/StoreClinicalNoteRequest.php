<?php

namespace App\Http\Requests\V1\Consultations;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Writing a clinical note.
 *
 * Deliberately permissive about completeness. Drafts persist continuously as
 * they are typed, so this endpoint has to accept a half-finished sentence: a
 * lost connection must never lose clinical text, and validation that demanded a
 * complete note would guarantee it did. Over-structuring the note is also the
 * fastest way to make a clinician abandon the system.
 *
 * What it will not accept is a note with no section, because an unclassified
 * note is unreadable to the next clinician.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md
 * @see docs/20-domain/domain-model.md
 */
class StoreClinicalNoteRequest extends FormRequest
{
    use RejectsUnknownFields;

    /**
     * The SOAP sections a clinician writes directly.
     *
     * `addendum` is absent on purpose: an addendum is never authored from
     * nothing, it always supersedes an existing note, and that is what the
     * addendum endpoint is for.
     *
     * @var list<string>
     */
    public const SECTIONS = ['subjective', 'objective', 'assessment', 'plan'];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'max:20000'],
            'note_type' => ['sometimes', Rule::in(self::SECTIONS)],
        ];
    }
}
