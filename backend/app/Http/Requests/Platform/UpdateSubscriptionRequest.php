<?php

namespace App\Http\Requests\Platform;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\SubscriptionPlan;
use App\Support\Money;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The plan a clinic is on, and what it agreed to pay.
 *
 * TWO FIELDS AND BOTH ARE REQUIRED TOGETHER, which is a deliberate refusal of
 * the obvious convenience. A tier alone would have to imply a price from a list,
 * and the first bespoke deal would then make that list a lie; a price alone
 * would leave a clinic paying for something nobody can name. Early plans in this
 * market are agreed in conversation (Business Plan SS-G), so the endpoint that
 * records one records both halves of what was agreed.
 *
 * WHOLE SHILLINGS ON THE WIRE. The column is minor units -- hundredths of a
 * shilling -- and every amount in this system is, but nobody in Uganda quotes
 * cents and a platform operator typing a monthly fee should type 250000. The
 * conversion happens here, once, in the one place a human types the number.
 *
 * @see docs/40-api/api-conventions.md
 */
class UpdateSubscriptionRequest extends FormRequest
{
    use RejectsUnknownFields;

    /**
     * A plan nobody could afford is almost certainly a typo, and a typo here
     * bills a real clinic. The ceiling is far above any plausible plan and far
     * below an accidental extra three zeros going unnoticed.
     */
    private const MAX_MONTHLY_SHILLINGS = 50_000_000;

    /** TenantPolicy holds the default-deny answer; the controller consults it. */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'plan' => ['required', Rule::enum(SubscriptionPlan::class)],
            // Integer, not numeric: a decimal shilling does not exist and a
            // float here is the beginning of a rounding defect in a money field.
            'price' => ['required', 'integer', 'min:1', 'max:'.self::MAX_MONTHLY_SHILLINGS],
        ];
    }

    public function plan(): SubscriptionPlan
    {
        return SubscriptionPlan::from((string) $this->validated('plan'));
    }

    /** Whole shillings in, minor units out. */
    public function price(): Money
    {
        return Money::ugx((int) $this->validated('price'));
    }
}
