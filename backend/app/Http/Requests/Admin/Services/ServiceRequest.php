<?php

namespace App\Http\Requests\Admin\Services;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\ClinicalRole;
use App\Models\ConsultationMode;
use App\Support\Currency;
use App\Support\Money;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Base for the service write requests.
 *
 * Authorisation is deliberately NOT decided here, matching the rest of the API:
 * the controller makes one role decision, and a second, weaker gate in the form
 * request is the kind of duplication that eventually disagrees with it.
 *
 * The price rules are the load-bearing part. `price_minor` is validated as an
 * INTEGER, which rejects `1500.50` and the string `"1500.50"` outright. That is
 * not pedantry: a float price is a rounding defect waiting for the first
 * percentage or fee split, and money that has been through a float cannot be
 * proven correct afterwards. The clinic sets this figure; Carevelo publishes no
 * price list and takes no margin.
 *
 * @see docs/20-domain/ubiquitous-language.md
 */
abstract class ServiceRequest extends FormRequest
{
    use RejectsUnknownFields;

    /**
     * A sanity ceiling, not a business limit.
     *
     * One billion shillings for a consultation is a mistyped amount, and
     * catching it here is cheaper than a patient seeing it.
     */
    public const MAX_PRICE_MINOR = 100_000_000_000;

    /** Five minutes to a full working day. */
    public const MIN_DURATION_MINUTES = 5;

    public const MAX_DURATION_MINUTES = 480;

    /**
     * @return array<string, mixed>
     */
    abstract public function rules(): array;

    /**
     * The shared field rules, with `$presence` applied to those the clinic must
     * supply on create and may omit on update.
     *
     * @param  list<string>  $presence
     * @return array<string, mixed>
     */
    protected function serviceRules(array $presence): array
    {
        return [
            'name' => [...$presence, 'string', 'min:2', 'max:120'],
            'description' => ['nullable', 'string', 'max:2000'],
            'duration_minutes' => [
                ...$presence, 'integer',
                'min:'.self::MIN_DURATION_MINUTES,
                'max:'.self::MAX_DURATION_MINUTES,
            ],

            // Integer minor units. Never a float.
            'price_minor' => [...$presence, 'integer', 'min:0', 'max:'.self::MAX_PRICE_MINOR],
            'currency' => ['nullable', Rule::enum(Currency::class)],

            // Which modes the clinic considers safe for this service is a
            // clinical judgement belonging to the clinic. We record it.
            'modes' => ['nullable', 'array', 'max:'.count(ConsultationMode::cases())],
            'modes.*' => [Rule::enum(ConsultationMode::class)],

            'eligible_roles' => ['nullable', 'array', 'max:'.count(ClinicalRole::tenantRoles())],
            'eligible_roles.*' => [Rule::in(array_map(
                static fn (ClinicalRole $role): string => $role->value,
                ClinicalRole::tenantRoles(),
            ))],

            'is_active' => ['nullable', 'boolean'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'price_minor.integer' => 'Give the price in whole minor units, as a number and not a decimal.',
            'duration_minutes.integer' => 'Give the appointment length in whole minutes.',
        ];
    }

    /**
     * Whether this request is changing the price at all.
     *
     * An update carrying only a name must leave the price untouched rather than
     * rewrite it from an absent field, which would read as zero.
     */
    public function changesPrice(): bool
    {
        return $this->has('price_minor');
    }

    /**
     * The price as a value object.
     *
     * Assembled here so no controller ever touches `price_minor` directly: the
     * Money cast owns the two-column write, and one entry point means one place
     * where the currency can be wrong.
     */
    public function price(): Money
    {
        $currency = $this->string('currency')->toString();

        return Money::of(
            $this->integer('price_minor'),
            $currency === '' ? Currency::UGX : Currency::from($currency),
        );
    }

    /**
     * The non-price attributes, omitting keys the client did not send.
     *
     * `only()` on absent keys would inject nulls and blank a description the
     * clinic never intended to clear.
     *
     * @return array<string, mixed>
     */
    public function serviceAttributes(): array
    {
        return $this->safe()->only([
            'name', 'description', 'duration_minutes', 'modes', 'eligible_roles', 'is_active',
        ]);
    }
}
