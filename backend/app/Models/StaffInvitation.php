<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Support\PhoneNumber;
use Database\Factories\StaffInvitationFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Str;
use InvalidArgumentException;

/**
 * An invitation for one person to join one clinic, in one role.
 *
 * THE ROLE IS FIXED HERE AND NOWHERE ELSE. Acceptance reads it off this row and
 * ignores whatever the request body claims, because a self-service role field
 * on a public endpoint is a one-request path from "front desk" to "clinic
 * administrator" -- the role that can change the clinic's aggregator
 * credentials.
 *
 * The link is sent by SMS, so possession of the token is the proof that the
 * invitee controls the invited handset. That makes the token a bearer
 * credential, and bearer credentials are stored hashed.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/50-security-compliance/rbac-matrix.md
 *
 * @property string $id
 * @property string $tenant_id
 * @property PhoneNumber $phone
 * @property string $name
 * @property string $role
 * @property string $token_hash
 * @property ?string $invited_by
 * @property Carbon $expires_at
 * @property ?Carbon $accepted_at
 * @property ?string $accepted_user_id
 */
class StaffInvitation extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<StaffInvitationFactory> */
    use HasFactory;

    use HasUlids;

    /**
     * Seven days.
     *
     * A clinic onboarding its staff does it over a week of shifts, not an
     * afternoon; an invitation that dies overnight becomes a support call. An
     * invitation that never dies becomes an unrevoked credential in an SMS
     * inbox on a handset that has since changed hands.
     */
    public const EXPIRES_AFTER_DAYS = 7;

    /** 32 bytes of entropy, hex encoded. Guessing is not a threat model. */
    public const TOKEN_BYTES = 32;

    protected $fillable = [
        'phone', 'name', 'role', 'token_hash', 'invited_by',
        'expires_at', 'accepted_at', 'accepted_user_id',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'phone' => PhoneNumber::class,
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
        ];
    }

    /**
     * Issue an invitation, returning the record and the plaintext token.
     *
     * The plaintext is returned once, for the SMS. It cannot be recovered
     * afterwards; a lost invitation is reissued, never looked up.
     *
     * @return array{self, string}
     *
     * @throws InvalidArgumentException when the role is not one a clinic may grant
     */
    public static function issue(
        string $phone,
        string $name,
        ClinicalRole $role,
        ?string $invitedBy = null,
    ): array {
        self::assertGrantable($role);

        $token = bin2hex(random_bytes(self::TOKEN_BYTES));

        $invitation = static::create([
            'phone' => $phone,
            'name' => $name,
            'role' => $role->value,
            'token_hash' => self::hashToken($token),
            'invited_by' => $invitedBy,
            'expires_at' => Date::now()->addDays(self::EXPIRES_AFTER_DAYS),
        ]);

        return [$invitation, $token];
    }

    /**
     * SHA-256, not bcrypt.
     *
     * The token is 256 bits of random, so there is nothing for a slow hash to
     * defend: brute force is already infeasible and a work factor would only
     * buy an attacker a denial-of-service lever on a public endpoint. A
     * deterministic digest is also what makes the unique index on token_hash a
     * single-row lookup rather than a scan comparing every live invitation.
     */
    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /**
     * The invitation for this token, within the current tenant.
     *
     * Tenant-scoped by the global scope and, underneath it, by row-level
     * security -- so a token issued by one clinic is simply not there on
     * another clinic's host, and the caller gets the same 404 as a token that
     * never existed.
     */
    public static function findByToken(string $token): ?self
    {
        return static::query()->where('token_hash', self::hashToken($token))->first();
    }

    /**
     * Clinics grant clinic roles.
     *
     * A platform role reaches across tenants, so no tenant may hand one out --
     * least of all through a link sent by SMS.
     *
     * @throws InvalidArgumentException
     */
    public static function assertGrantable(ClinicalRole $role): void
    {
        if ($role->isPlatformRole()) {
            throw new InvalidArgumentException(
                'A clinic cannot invite someone into the platform role ['.$role->value.'].'
            );
        }
    }

    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    public function isAccepted(): bool
    {
        return $this->accepted_at !== null;
    }

    public function role(): ClinicalRole
    {
        return ClinicalRole::from($this->role);
    }

    /** Single use: the row records who spent it, so a second attempt cannot. */
    public function markAcceptedBy(User $user): void
    {
        $this->accepted_at = Date::now();
        $this->accepted_user_id = $user->id;
        $this->save();
    }

    /**
     * A placeholder address for an invitee who gave none.
     *
     * The phone is the credential and email is optional throughout the product,
     * but the users table predates that decision and requires a unique,
     * non-null address. `.invalid` is reserved by RFC 2606 and can never
     * resolve, so this can never become somewhere a message is actually sent.
     */
    public static function placeholderEmail(): string
    {
        return Str::lower((string) Str::ulid()).'@invitation.invalid';
    }
}
