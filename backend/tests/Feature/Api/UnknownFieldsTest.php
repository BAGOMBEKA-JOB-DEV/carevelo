<?php

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;

/*
|--------------------------------------------------------------------------
| Unknown request fields are rejected, at every depth
|--------------------------------------------------------------------------
|
| Laravel silently discards a field no rule claims. That is how a clinic
| discovers weeks later that something was never saved -- a mistyped price
| charges the wrong amount, a mistyped note field is clinical content the
| clinician believes is recorded and is not.
|
| This trait previously existed as four per-module copies, and the weakest of
| them compared only TOP-LEVEL keys: a nested payload's unknown leaves passed
| straight through. These tests lock the consolidated leaf-level behaviour so
| that regression cannot return.
|
| @see docs/40-api/api-conventions.md
|
*/

/**
 * A minimal request exercising the trait directly, with a nested rule set.
 *
 * @param  array<string, mixed>  $payload
 * @return list<string> the field names the trait rejected
 */
function unknownFieldProbe(array $payload): array
{
    $request = new class extends FormRequest
    {
        use RejectsUnknownFields;

        /** @return array<string, mixed> */
        public function rules(): array
        {
            return [
                'reference' => ['required', 'string'],
                'items' => ['required', 'array'],
                'items.*.medicine_name' => ['required', 'string'],
                'items.*.unit_price_minor' => ['required', 'integer'],
            ];
        }
    };

    $request->merge($payload);

    $validator = validator($payload, $request->rules());

    foreach ($request->after() as $hook) {
        $hook($validator);
    }

    return array_values($validator->errors()->keys());
}

it('accepts a payload where every leaf is claimed by a rule', function () {
    $errors = unknownFieldProbe([
        'reference' => 'RX-2608-0001',
        'items' => [
            ['medicine_name' => 'Amoxicillin 500mg', 'unit_price_minor' => 150_000],
        ],
    ]);

    expect($errors)->toBeEmpty();
});

it('rejects an unknown top-level field', function () {
    $errors = unknownFieldProbe([
        'reference' => 'RX-2608-0001',
        'items' => [['medicine_name' => 'Amoxicillin', 'unit_price_minor' => 1]],
        'total_amount' => 999,
    ]);

    expect($errors)->toContain('total_amount');
});

it('rejects an unknown field NESTED inside an array element', function () {
    // The regression this file exists for. A top-level-only check compares
    // 'items' against the rule list, finds it, and waves the entire array
    // through -- including a mistyped price that is then silently dropped.
    $errors = unknownFieldProbe([
        'reference' => 'RX-2608-0001',
        'items' => [
            [
                'medicine_name' => 'Amoxicillin',
                'unit_price_minor' => 150_000,
                'unit_pirce_minor' => 999_999,
            ],
        ],
    ]);

    expect($errors)->toContain('items.0.unit_pirce_minor');
});

it('matches a wildcard rule against exactly one path segment', function () {
    // items.*.medicine_name must claim items.0.medicine_name and
    // items.1.medicine_name, without accidentally claiming deeper keys.
    $errors = unknownFieldProbe([
        'reference' => 'RX-2608-0001',
        'items' => [
            ['medicine_name' => 'A', 'unit_price_minor' => 1],
            ['medicine_name' => 'B', 'unit_price_minor' => 2],
        ],
    ]);

    expect($errors)->toBeEmpty();
});

it('is defined exactly once across the whole application', function () {
    // Four near-identical copies previously drifted apart in behaviour. One
    // implementation means one thing to test and one thing to fix.
    $copies = [];

    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS)
    );

    foreach ($files as $file) {
        if ($file->getFilename() === 'RejectsUnknownFields.php') {
            $copies[] = str_replace(base_path().'/', '', $file->getPathname());
        }
    }

    expect($copies)->toHaveCount(1)
        ->and($copies[0])->toBe('app/Http/Requests/Concerns/RejectsUnknownFields.php');
});
