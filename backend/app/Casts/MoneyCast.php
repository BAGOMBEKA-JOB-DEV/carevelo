<?php

namespace App\Casts;

use App\Support\Currency;
use App\Support\Money;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

/**
 * Casts a Money value across two columns: `{attribute}_minor` and `currency`.
 *
 * Two columns rather than one so the amount stays a native integer the database
 * can sum, index and compare — a serialised blob would make every financial
 * query useless.
 *
 * The set type is `mixed` rather than `Money` because Eloquent hands the cast
 * whatever the caller assigned. The runtime guard below is the thing that
 * actually stops a float or a string being written to a money column, so the
 * annotation must not claim a certainty the framework does not provide.
 *
 * @implements CastsAttributes<Money, mixed>
 */
class MoneyCast implements CastsAttributes
{
    public function __construct(protected string $currencyColumn = 'currency') {}

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): ?Money
    {
        $minor = $attributes[$key.'_minor'] ?? null;

        if ($minor === null) {
            return null;
        }

        $currency = $attributes[$this->currencyColumn] ?? Currency::UGX->value;

        return Money::of((int) $minor, Currency::from((string) $currency));
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): array
    {
        if ($value === null) {
            return [$key.'_minor' => null];
        }

        if (! $value instanceof Money) {
            throw new InvalidArgumentException(
                sprintf('%s must be set to a %s instance.', $key, Money::class)
            );
        }

        return [
            $key.'_minor' => $value->amountMinor,
            $this->currencyColumn => $value->currency->value,
        ];
    }
}
