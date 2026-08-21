<?php

namespace Database\Factories;

use App\Models\OutboundNotification;
use App\Support\Notifications\NotificationChannel;
use App\Support\Notifications\NotificationStatus;
use App\Support\Notifications\TemplateRegistry;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Date;

/** @extends Factory<OutboundNotification> */
class OutboundNotificationFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        // Rendered from the real catalogue rather than typed out here, so a
        // fixture can never become the one message body in the codebase that
        // nobody reviewed.
        $body = app(TemplateRegistry::class)
            ->get(TemplateRegistry::PRESCRIPTION_READY)
            ->render([
                'clinic' => 'Kira Family Clinic',
                'sign_in_link' => 'https://kira.carevelo.ug/s/ab12cd',
            ]);

        return [
            'channel' => NotificationChannel::Sms,
            'recipient' => '+2567'.fake()->numerify('########'),
            'template_key' => TemplateRegistry::PRESCRIPTION_READY,
            'body' => $body,
            'status' => NotificationStatus::Queued,
        ];
    }

    public function sent(): static
    {
        return $this->state(fn () => [
            'status' => NotificationStatus::Sent,
            'sent_at' => Date::now(),
        ]);
    }

    public function delivered(): static
    {
        return $this->state(fn () => [
            'status' => NotificationStatus::Delivered,
            'sent_at' => Date::now()->subMinute(),
            'delivered_at' => Date::now(),
        ]);
    }

    public function failed(string $reason = 'gateway_unavailable'): static
    {
        return $this->state(fn () => [
            'status' => NotificationStatus::Failed,
            'failure_reason' => $reason,
        ]);
    }
}
