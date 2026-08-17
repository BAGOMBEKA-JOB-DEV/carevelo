<?php

namespace App\Http\Requests\V1\Reads;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Http\Requests\V1\Reads\Concerns\ResolvesClinicDays;
use App\Support\Notifications\NotificationChannel;
use App\Support\Notifications\NotificationStatus;
use App\Support\Notifications\TemplateRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Filters for the send history.
 *
 * Deliberately not filterable by recipient. The history answers "was the
 * patient told?", which staff reach from the patient's own record; a free
 * lookup by phone number would turn this endpoint into a way to ask "is this
 * number a patient here?" -- and under DPPA 2019 that answer is itself
 * special-category data.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md
 */
class IndexNotificationRequest extends FormRequest
{
    use RejectsUnknownFields;
    use ResolvesClinicDays;

    public const DEFAULT_PER_PAGE = 25;

    public const MAX_PER_PAGE = 100;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'status' => ['sometimes', Rule::enum(NotificationStatus::class)],
            'channel' => ['sometimes', Rule::enum(NotificationChannel::class)],
            // The catalogue is a closed list, so an unknown key is a client bug
            // rather than an empty result set to puzzle over.
            'template_key' => ['sometimes', 'string', Rule::in(array_keys(app(TemplateRegistry::class)->all()))],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            'cursor' => ['sometimes', 'string'],
        ];
    }

    public function status(): ?NotificationStatus
    {
        $status = $this->validated('status');

        return is_string($status) ? NotificationStatus::from($status) : null;
    }

    public function channel(): ?NotificationChannel
    {
        $channel = $this->validated('channel');

        return is_string($channel) ? NotificationChannel::from($channel) : null;
    }

    public function templateKey(): ?string
    {
        $key = $this->validated('template_key');

        return is_string($key) ? $key : null;
    }

    public function from(): ?CarbonImmutable
    {
        return $this->dayStart('from');
    }

    public function to(): ?CarbonImmutable
    {
        return $this->dayEnd('to');
    }

    public function perPage(): int
    {
        $perPage = $this->validated('per_page');

        return is_numeric($perPage) ? (int) $perPage : self::DEFAULT_PER_PAGE;
    }
}
