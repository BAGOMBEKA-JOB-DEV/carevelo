<?php

namespace App\Http\Requests\Concerns;

use Closure;
use Illuminate\Support\Arr;
use Illuminate\Validation\Validator;

/**
 * Rejects request fields the endpoint does not define.
 *
 * ONE shared implementation for the whole API. It previously existed as four
 * near-identical per-module copies, two of which behaved differently -- and the
 * weakest compared only TOP-LEVEL keys, so a nested payload's unknown leaves
 * passed straight through. That is the failure this trait exists to prevent, so
 * a variant that permits it is worse than none.
 *
 * An unknown field is silently discarded by Laravel's default behaviour, which
 * is how a clinic discovers weeks later that something was never saved. The cost
 * varies by endpoint and is never trivial: a mistyped `unit_price_minor` charges
 * a patient the wrong amount; a mistyped note field is clinical content the
 * clinician believes is recorded and is not.
 *
 * Leaf-level, because payloads nest: `items.0.unit_price_minor` is checked
 * against the `items.*.unit_price_minor` rule, and a check comparing only
 * `items` would wave the whole array through.
 *
 * @see docs/40-api/api-conventions.md
 */
trait RejectsUnknownFields
{
    /**
     * The rule set is the field allow-list; there is no second list to drift.
     *
     * @return array<string, mixed>
     */
    abstract public function rules(): array;

    /**
     * @return array<int, Closure>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                foreach ($this->unknownFields() as $field) {
                    $validator->errors()->add($field, 'This field is not recognised.');
                }
            },
        ];
    }

    /**
     * Leaf keys of the payload that no validation rule claims.
     *
     * Arr::dot flattens to leaves only, so `items.0.unit_price_minor` is
     * compared against the `items.*.unit_price_minor` rule with `*` matching
     * exactly one segment.
     *
     * @return list<string>
     */
    protected function unknownFields(): array
    {
        $patterns = array_map(
            static fn (string $rule): string => '#^'.str_replace('\*', '[^.]+', preg_quote($rule, '#')).'$#',
            array_keys($this->rules()),
        );

        $unknown = [];

        foreach (array_keys(Arr::dot($this->all())) as $key) {
            $field = (string) $key;

            foreach ($patterns as $pattern) {
                if (preg_match($pattern, $field) === 1) {
                    continue 2;
                }
            }

            $unknown[] = $field;
        }

        return $unknown;
    }
}
