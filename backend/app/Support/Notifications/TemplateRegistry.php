<?php

namespace App\Support\Notifications;

use InvalidArgumentException;

/**
 * The complete catalogue of messages Carevelo may send.
 *
 * If a template is not here, it cannot be sent. That is the point: the content
 * rule is reviewable only because this file is short and every message in the
 * product passes through it.
 *
 * Read each pattern as though a stranger were holding the handset, because on a
 * shared phone in a household one often is. Every one of them says that
 * something is ready and where to sign in; none says what it is.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md catalogue
 */
class TemplateRegistry
{
    public const APPOINTMENT_CONFIRMED = 'appointment.confirmed';

    public const APPOINTMENT_REMINDER = 'appointment.reminder';

    public const APPOINTMENT_CANCELLED = 'appointment.cancelled';

    public const PAYMENT_SUCCEEDED = 'payment.succeeded';

    public const PAYMENT_FAILED = 'payment.failed';

    public const PRESCRIPTION_READY = 'prescription.ready';

    public const ORDER_PRICED = 'order.priced';

    public const ORDER_READY_FOR_PICKUP = 'order.ready_for_pickup';

    public const DELIVERY_ON_ITS_WAY = 'delivery.on_its_way';

    public const DELIVERY_COMPLETED = 'delivery.completed';

    public const RESULTS_AVAILABLE = 'results.available';

    public const STAFF_INVITATION = 'staff.invitation';

    /** @var array<string, NotificationTemplate>|null */
    private ?array $templates = null;

    /**
     * @return array<string, NotificationTemplate>
     */
    public function all(): array
    {
        return $this->templates ??= $this->build();
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->all());
    }

    /**
     * @throws InvalidArgumentException when no such template is registered
     */
    public function get(string $key): NotificationTemplate
    {
        return $this->all()[$key] ?? throw new InvalidArgumentException(
            "No notification template [{$key}]. Templates are a closed list; add one to ".
            self::class.' and to docs/10-product/notifications-sms-whatsapp.md in the same change.'
        );
    }

    /**
     * @return array<string, NotificationTemplate>
     */
    private function build(): array
    {
        $templates = [
            /*
             * The only templates offered on WhatsApp are the two appointment
             * messages a patient may want to keep and re-read. SMS still goes
             * in every case -- WhatsApp is additive, never a substitute.
             */
            new NotificationTemplate(
                key: self::APPOINTMENT_CONFIRMED,
                pattern: 'Your appointment with {clinic} is confirmed for {starts_at}. '
                    .'Join here: {join_link}',
                channels: [NotificationChannel::Sms, NotificationChannel::WhatsApp],
                isCritical: true,
            ),

            new NotificationTemplate(
                key: self::APPOINTMENT_REMINDER,
                pattern: 'Reminder from {clinic}: your appointment is at {starts_at}. '
                    .'Join here: {join_link}',
                channels: [NotificationChannel::Sms, NotificationChannel::WhatsApp],
            ),

            /*
             * No reason is given for the cancellation. The reason is frequently
             * clinical -- and where it is not, the patient still needs to speak
             * to the clinic rather than to us.
             */
            new NotificationTemplate(
                key: self::APPOINTMENT_CANCELLED,
                pattern: 'Your appointment with {clinic} on {starts_at} has been cancelled. '
                    .'Call {clinic_phone} to book another time.',
                isCritical: true,
            ),

            /*
             * Money messages carry a reference so the patient can quote it to
             * the clinic. Carevelo never saw the money -- the reference is the
             * clinic's own aggregator reference, and it is all we have.
             */
            new NotificationTemplate(
                key: self::PAYMENT_SUCCEEDED,
                pattern: '{clinic} has received your payment of {amount}. Reference {reference}.',
                isCritical: true,
            ),

            new NotificationTemplate(
                key: self::PAYMENT_FAILED,
                pattern: 'Your payment of {amount} to {clinic} did not go through. '
                    .'Try again here: {retry_link}',
                isCritical: true,
            ),

            /*
             * The template the whole document exists for.
             *
             * "Your prescription for Amoxicillin is ready" is more helpful and
             * is a disclosure of health data to the operator, the household and
             * anyone who picks up the handset. The medicine name lives behind
             * the sign-in link, and nowhere else.
             */
            new NotificationTemplate(
                key: self::PRESCRIPTION_READY,
                pattern: 'Your prescription from {clinic} is ready. Sign in to view it: {sign_in_link}',
                isCritical: true,
            ),

            /*
             * A total, never an itemised list: the items ARE the prescription.
             */
            new NotificationTemplate(
                key: self::ORDER_PRICED,
                pattern: 'Your order from {clinic} is ready to pay. Total {total}. '
                    .'Pay here: {payment_link}',
                isCritical: true,
            ),

            new NotificationTemplate(
                key: self::ORDER_READY_FOR_PICKUP,
                pattern: 'Your order from {clinic} is ready for collection. Reference {reference}.',
                isCritical: true,
            ),

            /*
             * "Your package", never its contents -- and the tracking page the
             * link opens is the rider-safe view, which has no clinical fields
             * to leak in the first place.
             */
            new NotificationTemplate(
                key: self::DELIVERY_ON_ITS_WAY,
                pattern: 'Your package from {clinic} is on its way. Track it here: {tracking_link}',
                isCritical: true,
            ),

            new NotificationTemplate(
                key: self::DELIVERY_COMPLETED,
                pattern: 'Your package from {clinic} was delivered. Reference {reference}.',
            ),

            /*
             * Phase 2, registered now so it cannot be improvised later.
             *
             * §H6.2 states the principle for lab results specifically: the
             * result never leaves the authenticated surface. "Your results are
             * ready" is the entire permissible message.
             */
            new NotificationTemplate(
                key: self::RESULTS_AVAILABLE,
                pattern: 'Your results from {clinic} are ready. Sign in to view them: {sign_in_link}',
                isCritical: true,
            ),

            /*
             * Staff, not a patient -- but the same channel, so the same rule.
             */
            new NotificationTemplate(
                key: self::STAFF_INVITATION,
                pattern: 'You have been invited to join {clinic} on Carevelo. '
                    .'Set up your account here: {setup_link}',
                isCritical: true,
            ),
        ];

        $keyed = [];

        foreach ($templates as $template) {
            $keyed[$template->key] = $template;
        }

        return $keyed;
    }
}
