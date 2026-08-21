<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Permission for one participant to join one consultation, once, soon.
 *
 * Every property the architecture requires of a join token is enforced here,
 * because the video provider can enforce none of them. It is told a room name and
 * nothing else — no patient identity, no reason for the consultation — so it has
 * no basis on which to refuse anyone.
 *
 *   short-lived      expires_at, and never beyond the slot by more than the grace
 *   single-use       consumed_at, checked and set in one transaction
 *   participant-bound  user_id, so a forwarded token is useless to the recipient
 *   appointment-scoped appointment_id
 *   never guessable  32 random bytes, stored hashed
 *
 * @see docs/30-architecture/realtime-and-video.md
 *
 * @property string $id
 * @property string $appointment_id
 * @property string $user_id
 * @property string $token_hash
 * @property string $room_name
 * @property Carbon $expires_at
 * @property ?Carbon $consumed_at
 */
class JoinToken extends Model
{
    use BelongsToTenant;
    use HasUlids;

    /**
     * How long a token lives once issued.
     *
     * Long enough to survive a patient fumbling a slow connection, short enough
     * that a token copied out of a browser history is useless.
     */
    public const TTL_MINUTES = 15;

    /**
     * How long after the slot ends a token may still be issued.
     *
     * Consultations overrun, and a clinician cut off at the scheduled minute is a
     * worse outcome than one who runs late.
     */
    public const GRACE_MINUTES = 30;

    protected $fillable = [
        'appointment_id', 'user_id', 'token_hash', 'room_name',
        'expires_at', 'consumed_at',
    ];

    /**
     * expires_at and consumed_at are timestamptz.
     *
     * Laravel's default format is naive ('Y-m-d H:i:s'), so PostgreSQL resolves
     * the missing offset in the SESSION's timezone rather than the application's.
     * What shifts here is the lifetime of a credential: a token born already
     * expired locks both parties out of a consultation they have paid for, and one
     * born hours long is a link that keeps working.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'consumed_at' => 'datetime',
        ];
    }

    /**
     * Issue a token for one participant, returning the record and the plaintext.
     *
     * The plaintext is returned and never stored, exactly as StaffInvitation does
     * it: this is the only moment it may exist, and the caller hands it straight
     * to the participant.
     *
     * @return array{self, string}
     */
    public static function issueFor(Appointment $appointment, User $user): array
    {
        // 64 characters from the CSPRNG, via Str::random's random_bytes. An
        // identifier a person could guess, or enumerate from a neighbouring one,
        // is not a credential -- and this one opens a consultation.
        $plaintext = Str::random(64);

        $record = static::create([
            'appointment_id' => $appointment->id,
            'user_id' => $user->id,
            'token_hash' => Hash::make($plaintext),
            'room_name' => self::roomNameFor($appointment),
            'expires_at' => Date::now()->addMinutes(self::TTL_MINUTES),
        ]);

        return [$record, $plaintext];
    }

    /**
     * The opaque room identifier the provider is given.
     *
     * A ULID and a prefix. Nothing about the patient, the clinician, the clinic or
     * the reason for the consultation — the provider is a third party, frequently
     * outside Uganda, and this string is all it learns.
     */
    public static function roomNameFor(Appointment $appointment): string
    {
        return 'apt-'.$appointment->id;
    }

    /** @return BelongsTo<Appointment, $this> */
    public function appointment(): BelongsTo
    {
        return $this->belongsTo(Appointment::class);
    }

    public function matches(string $candidate): bool
    {
        return Hash::check($candidate, $this->token_hash);
    }

    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    public function isConsumed(): bool
    {
        return $this->consumed_at !== null;
    }

    /** Usable right now: neither spent nor timed out. */
    public function isLive(): bool
    {
        return ! $this->isConsumed() && ! $this->isExpired();
    }

    /**
     * Whether this token belongs to the account presenting it.
     *
     * The check that makes a forwarded token worthless.
     */
    public function belongsToParticipant(User $user): bool
    {
        return $this->user_id === $user->id;
    }

    public function consume(): void
    {
        $this->consumed_at = Date::now();
        $this->save();
    }
}
