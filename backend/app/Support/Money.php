<?php

namespace App\Support;

use App\Casts\MoneyCast;
use Illuminate\Contracts\Database\Eloquent\Castable;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use JsonSerializable;
use Stringable;

/**
 * An amount of money: integer minor units plus an explicit currency.
 *
 * Never a float. Ugandan shillings have no subunit in practice, so it is
 * tempting to store whole shillings as a plain integer — but the moment a
 * percentage or fee split lands, floating point rounding becomes a financial
 * defect. Storing minor units from the start means the type never has to
 * change and no migration ever reinterprets existing rows.
 *
 * Implements Castable, so models declare `'total' => Money::class` and the
 * value object is wired into Eloquent rather than standing beside it.
 *
 * @see docs/20-domain/ubiquitous-language.md
 */
final class Money implements Castable, JsonSerializable, Stringable
{
    private function __construct(
        public readonly int $amountMinor,
        public readonly Currency $currency,
    ) {}

    public static function of(int $amountMinor, Currency $currency = Currency::UGX): self
    {
        return new self($amountMinor, $currency);
    }

    /** Readable test and seed data: Money::ugx(150_000). */
    public static function ugx(int $wholeShillings): self
    {
        return new self($wholeShillings * 100, Currency::UGX);
    }

    public static function zero(Currency $currency = Currency::UGX): self
    {
        return new self(0, $currency);
    }

    /**
     * @return class-string<CastsAttributes<Money, mixed>>
     */
    public static function castUsing(array $arguments): string
    {
        return MoneyCast::class;
    }

    /*
     * There is deliberately no assertSameCurrency() guard.
     *
     * Currency has exactly one case, because multi-country expansion is a
     * permanent non-goal -- the Ugandan regulatory model is baked deep into
     * this system on purpose. A same-currency check today is unreachable code
     * that static analysis correctly flags as always-true.
     *
     * If a second currency is ever added, reinstate the guard in plus(),
     * minus() and isGreaterThan() at the same time.
     *
     * @see docs/10-product/non-goals.md
     */

    public function plus(self $other): self
    {
        return new self($this->amountMinor + $other->amountMinor, $this->currency);
    }

    public function minus(self $other): self
    {
        return new self($this->amountMinor - $other->amountMinor, $this->currency);
    }

    public function times(int $quantity): self
    {
        return new self($this->amountMinor * $quantity, $this->currency);
    }

    public function isZero(): bool
    {
        return $this->amountMinor === 0;
    }

    public function isNegative(): bool
    {
        return $this->amountMinor < 0;
    }

    public function equals(self $other): bool
    {
        return $this->amountMinor === $other->amountMinor;
    }

    public function isGreaterThan(self $other): bool
    {
        return $this->amountMinor > $other->amountMinor;
    }

    /**
     * Human display, e.g. "UGX 150,000".
     *
     * UGX is shown without decimals because that is how it is written and
     * spoken in Uganda; "UGX 150,000.00" reads as foreign.
     */
    public function format(): string
    {
        $major = intdiv($this->amountMinor, 100);
        $minor = abs($this->amountMinor % 100);

        return $this->currency->hasSubunitInPractice()
            ? sprintf('%s %s.%02d', $this->currency->value, number_format($major), $minor)
            : sprintf('%s %s', $this->currency->value, number_format($major));
    }

    public function __toString(): string
    {
        return $this->format();
    }

    /**
     * @return array{amount_minor: int, currency: string}
     */
    public function jsonSerialize(): array
    {
        return [
            'amount_minor' => $this->amountMinor,
            'currency' => $this->currency->value,
        ];
    }
}
