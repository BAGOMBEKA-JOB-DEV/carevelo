<?php

namespace App\Broadcasting;

use Illuminate\Broadcasting\PrivateChannel;
use InvalidArgumentException;

/**
 * The only way to name a broadcast channel.
 *
 * Every channel in Carevelo is private and tenant-prefixed. An unprefixed name
 * is the same defect as an unprefixed cache key and worse in one respect: a
 * cache leak waits for someone to make a request, while a channel leak PUSHES
 * another clinic's data to a subscriber unprompted, and our tenants are
 * frequently each other's local competitors.
 *
 * So there is no public way to concatenate one. Every constructor here is a
 * named method that takes the tenant first and validates every segment, and the
 * class cannot be instantiated. A manually built channel name is a defect,
 * reviewable on sight.
 *
 * @see docs/30-architecture/realtime-broadcasting.md
 * @see docs/30-architecture/multi-tenancy.md
 */
final class TenantChannel
{
    /**
     * The registered authorisation patterns.
     *
     * These are the strings routes/channels.php binds handlers to. They carry
     * no `private-` prefix because the broadcaster strips it from the incoming
     * channel name before matching; the PrivateChannel objects returned below
     * add it back on the way out.
     */
    public const PHARMACY_QUEUE = 'tenant.{tenantId}.pharmacy-queue';

    public const DISPATCH_BOARD = 'tenant.{tenantId}.dispatch-board';

    public const USER = 'tenant.{tenantId}.user.{userId}';

    public const PATIENT = 'tenant.{tenantId}.patient.{patientId}';

    public const RIDER = 'tenant.{tenantId}.rider.{userId}';

    public const CONSULTATION = 'tenant.{tenantId}.consultation.{consultationId}';

    /** Not instantiable: this is a naming vocabulary, not a service. */
    private function __construct() {}

    /** Order arrived, order state changed. Pharmacists and administrators. */
    public static function pharmacyQueue(string $tenantId): PrivateChannel
    {
        return new PrivateChannel(sprintf('tenant.%s.pharmacy-queue', self::segment($tenantId, 'tenant')));
    }

    /** Delivery created, assigned, status changed. Dispatchers and administrators. */
    public static function dispatchBoard(string $tenantId): PrivateChannel
    {
        return new PrivateChannel(sprintf('tenant.%s.dispatch-board', self::segment($tenantId, 'tenant')));
    }

    /** Personal notifications for one staff member — nobody else joins it. */
    public static function user(string $tenantId, string $userId): PrivateChannel
    {
        return new PrivateChannel(sprintf(
            'tenant.%s.user.%s',
            self::segment($tenantId, 'tenant'),
            self::segment($userId, 'user'),
        ));
    }

    /** One patient's own appointment, payment, order and delivery state. */
    public static function patient(string $tenantId, string $patientId): PrivateChannel
    {
        return new PrivateChannel(sprintf(
            'tenant.%s.patient.%s',
            self::segment($tenantId, 'tenant'),
            self::segment($patientId, 'patient'),
        ));
    }

    /**
     * One rider's own assignments.
     *
     * The most restricted channel in the system, carrying assignment
     * identifiers and nothing else. The rider is the least-trusted human actor
     * and needs the least data.
     */
    public static function rider(string $tenantId, string $riderId): PrivateChannel
    {
        return new PrivateChannel(sprintf(
            'tenant.%s.rider.%s',
            self::segment($tenantId, 'tenant'),
            self::segment($riderId, 'rider'),
        ));
    }

    /** Consultation SESSION state. Never consultation media — Reverb carries none. */
    public static function consultation(string $tenantId, string $consultationId): PrivateChannel
    {
        return new PrivateChannel(sprintf(
            'tenant.%s.consultation.%s',
            self::segment($tenantId, 'tenant'),
            self::segment($consultationId, 'consultation'),
        ));
    }

    /**
     * Every pattern this application authorises, for tests and tooling.
     *
     * @return list<string>
     */
    public static function patterns(): array
    {
        return [
            self::PHARMACY_QUEUE,
            self::DISPATCH_BOARD,
            self::USER,
            self::PATIENT,
            self::RIDER,
            self::CONSULTATION,
        ];
    }

    /**
     * Validate one dot-separated segment of a channel name.
     *
     * An empty tenant would yield `tenant..pharmacy-queue` — structurally
     * unprefixed, and matched by nothing. A segment containing a dot would let
     * a caller smuggle extra segments in and produce a name that authorises as
     * one channel and delivers as another. Both are refused loudly at
     * construction rather than discovered in production.
     */
    private static function segment(string $value, string $label): string
    {
        if ($value === '' || str_contains($value, '.')) {
            throw new InvalidArgumentException(sprintf(
                'A broadcast channel needs a non-empty, dot-free %s identifier. '
                .'Every channel is tenant-prefixed and there is no unprefixed form.',
                $label,
            ));
        }

        return $value;
    }
}
