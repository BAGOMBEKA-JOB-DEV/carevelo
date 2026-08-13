<?php

namespace App\Support\Notifications;

use InvalidArgumentException;

/**
 * One message the platform is allowed to send.
 *
 * A template is a closed vocabulary: a pattern with named placeholders and
 * nothing else. There is no free-text notification anywhere in this system, and
 * that absence is the reason the content rule can be tested at all -- you
 * cannot review every string a caller might invent, but you can review twelve
 * patterns.
 *
 * Invariants are enforced in the constructor rather than by convention, so a
 * template that breaks one cannot be constructed, let alone sent.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md
 */
final class NotificationTemplate
{
    /** Placeholder syntax: {clinic}, {starts_at}, {join_link}. */
    private const PLACEHOLDER = '/\{([a-z_]+)\}/';

    /**
     * A literal URL, or a placeholder that will be filled with one.
     *
     * Matching the placeholder NAME as well as the value matters: the OTP rule
     * has to hold at authoring time, not only once a link has been interpolated
     * and the message is already on its way.
     */
    private const LINK = '/https?:\/\/|www\.|\{[a-z_]*(?:link|url)[a-z_]*\}/i';

    /**
     * @param  string  $key  dot-separated event name: 'prescription.ready'
     * @param  list<NotificationChannel>  $channels
     * @param  bool  $isCritical  whether a permanent failure must be surfaced to clinic staff
     * @param  bool  $permitsLink  false where a link would be an attack surface rather than a convenience
     * @param  string  $queue  'high' for anything a person is actively waiting on
     */
    public function __construct(
        public readonly string $key,
        public readonly string $pattern,
        public readonly array $channels = [NotificationChannel::Sms],
        public readonly bool $isCritical = false,
        public readonly bool $permitsLink = true,
        public readonly string $queue = 'default',
    ) {
        // WhatsApp is opt-in, needs data and an installed app, and its
        // templates need pre-approval. A WhatsApp-only template would silently
        // never reach the patients least able to chase the clinic.
        if (! in_array(NotificationChannel::Sms, $channels, true)) {
            throw new InvalidArgumentException(
                "Template [{$key}] omits SMS. WhatsApp is never the sole channel."
            );
        }

        // The clinic is the sender. A message a patient cannot attribute to the
        // clinic they attended reads as a scam, and patients are right to
        // ignore it -- so the sender is structural, not a caller's choice.
        if (! str_contains($pattern, '{clinic}')) {
            throw new InvalidArgumentException(
                "Template [{$key}] does not identify the clinic as sender."
            );
        }

        ProhibitedContent::assertClean($pattern, "template [{$key}]");

        if (! $permitsLink && preg_match(self::LINK, $pattern) === 1) {
            throw new InvalidArgumentException(
                "Template [{$key}] carries a link but is declared link-free."
            );
        }
    }

    /**
     * The placeholder names this template requires, in order of appearance.
     *
     * @return list<string>
     */
    public function placeholders(): array
    {
        preg_match_all(self::PLACEHOLDER, $this->pattern, $matches);

        /** @var list<string> $names */
        $names = array_values(array_unique($matches[1]));

        return $names;
    }

    public function supports(NotificationChannel $channel): bool
    {
        return in_array($channel, $this->channels, true);
    }

    /**
     * Render the message.
     *
     * Every interpolated value is checked against the prohibited-content list
     * before it goes in -- except the clinic name, for the reason given on
     * ProhibitedContent. A missing placeholder is fatal rather than rendered as
     * an empty string: "Your appointment is confirmed for ." is worse than an
     * exception, because it reaches the patient.
     *
     * @param  array<string, string|int>  $parameters
     *
     * @throws InvalidArgumentException|ProhibitedNotificationContent
     */
    public function render(array $parameters): string
    {
        $body = $this->pattern;

        foreach ($this->placeholders() as $name) {
            if (! array_key_exists($name, $parameters)) {
                throw new InvalidArgumentException(
                    "Template [{$this->key}] requires parameter [{$name}]."
                );
            }

            $value = (string) $parameters[$name];

            if ($name !== 'clinic') {
                ProhibitedContent::assertClean($value, "parameter [{$name}] of template [{$this->key}]");
            }

            $body = str_replace('{'.$name.'}', $value, $body);
        }

        // Belt and braces on the OTP rule. An OTP message asks for the one
        // thing an attacker needs, so it must never also teach the patient that
        // a link in such a message is normal.
        if (! $this->permitsLink && preg_match(self::LINK, $body) === 1) {
            throw new InvalidArgumentException(
                "Template [{$this->key}] rendered a link into a link-free message."
            );
        }

        return $body;
    }
}
