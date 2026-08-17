<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Support\Auth\OtpPurpose;
use App\Support\PhoneNumber;
use Database\Factories\OtpCodeFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Hash;

/**
 * A one-time code issued to a phone number, for five minutes, once.
 *
 * The code is a credential for as long as it lives, so it is HASHED AT REST:
 * a leaked table hands over no active codes, only digests of expired ones. The
 * plaintext exists in one request, travels to one handset, and is never written
 * to a log line, an audit event or a notification record read by staff.
 *
 * A spent code is kept rather than deleted. Deleting it would make a replay
 * indistinguishable from a wrong guess, and a replay is the interesting event:
 * somebody is using a code they should not have.
 *
 * @see docs/40-api/authentication-and-sessions.md
 *
 * @property string $id
 * @property string $tenant_id
 * @property PhoneNumber $phone
 * @property string $code_hash
 * @property OtpPurpose $purpose
 * @property Carbon $expires_at
 * @property ?Carbon $consumed_at
 * @property int $attempts
 * @property ?string $ip_address
 * @property ?Carbon $created_at
 */
class OtpCode extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<OtpCodeFactory> */
    use HasFactory;

    use HasUlids;

    /** Six digits. Short enough to read off a lock screen and retype. */
    public const LENGTH = 6;

    /**
     * Five minutes.
     *
     * Long enough for an SMS to arrive over a congested network, short enough
     * that a code glimpsed on someone else's handset is worthless by the time
     * it could be used.
     */
    public const TTL_MINUTES = 5;

    /**
     * Wrong guesses before the code is burned.
     *
     * A six-digit code has a million possibilities, which an attacker with
     * unlimited guesses exhausts by patience alone. The per-number rate limit
     * makes that slow; this makes it impossible for any single code.
     */
    public const MAX_ATTEMPTS = 5;

    protected $fillable = [
        'phone', 'code_hash', 'purpose', 'expires_at',
        'consumed_at', 'attempts', 'ip_address',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'phone' => PhoneNumber::class,
            'purpose' => OtpPurpose::class,
            'expires_at' => 'datetime',
            'consumed_at' => 'datetime',
            'attempts' => 'integer',
        ];
    }

    /**
     * Issue a code, returning the record and the plaintext.
     *
     * The plaintext is returned rather than stored because this is the only
     * moment it may exist: the caller hands it to the SMS gateway and drops it.
     *
     * @return array{self, string}
     */
    public static function issue(
        string $phone,
        OtpPurpose $purpose = OtpPurpose::SignIn,
        ?string $ipAddress = null,
    ): array {
        // random_int, not rand(): this is a credential, and a predictable one
        // is no credential at all. Padded so a code beginning with a zero is
        // still six digits -- 043118 is a valid code and 43118 is a support
        // call.
        $code = str_pad((string) random_int(0, 999_999), self::LENGTH, '0', STR_PAD_LEFT);

        $record = static::create([
            'phone' => $phone,
            'code_hash' => Hash::make($code),
            'purpose' => $purpose,
            'expires_at' => Date::now()->addMinutes(self::TTL_MINUTES),
            'ip_address' => $ipAddress,
        ]);

        return [$record, $code];
    }

    public function matches(string $candidate): bool
    {
        return Hash::check($candidate, $this->code_hash);
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

    public function consume(): void
    {
        $this->consumed_at = Date::now();
        $this->save();
    }

    /**
     * Record a wrong guess, burning the code once the budget is gone.
     *
     * Burned rather than merely counted, so an exhausted code cannot later be
     * brute-forced from a fresh IP address once the rate limit decays.
     */
    public function registerFailedAttempt(): void
    {
        $this->attempts++;

        if ($this->attempts >= self::MAX_ATTEMPTS) {
            $this->consumed_at = Date::now();
        }

        $this->save();
    }
}
