<?php

namespace App\Models;

use App\Support\PhoneNumber;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Spatie\Permission\Traits\HasRoles;

/**
 * An account — clinic staff, platform staff, or a patient.
 *
 * Clinic staff belong to exactly one tenant. There is no cross-tenant staff
 * identity: someone working at two clinics has two accounts, which follows
 * directly from the isolation boundary. The same is true of patients, which is
 * why a patient attending two clinics has two records and two logins.
 *
 * A patient account reaches clinical data only through the records it owns —
 * see patients() and owns(). Holding ClinicalRole::Patient grants nothing on its
 * own; the link to a Patient row is what does.
 *
 * Platform users (Carevelo staff) have a null tenant_id and reach no clinical
 * data without an audited break-glass grant.
 *
 * Deliberately NOT tenant-scoped via BelongsToTenant: authentication has to
 * find the user before a tenant is resolved, so the global scope would make
 * sign-in impossible. Authorisation is enforced by the host/session tenant
 * check in ResolveTenant and by policies.
 *
 * @see docs/20-domain/domain-model.md
 * @see docs/50-security-compliance/rbac-matrix.md
 *
 * @property string $id
 * @property ?string $tenant_id
 * @property string $name
 * @property ?string $email
 * @property ?PhoneNumber $phone
 * @property bool $is_active
 * @property ?Carbon $password_change_required_at
 * @property ?string $totp_secret_encrypted
 * @property ?Carbon $totp_confirmed_at
 * @property ?int $totp_last_used_step
 */
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory;

    use HasRoles;
    use HasUlids;
    use Notifiable;

    /**
     * Memoised result of ownedPatientIds(), for the life of this instance.
     *
     * @var ?list<string>
     */
    protected ?array $ownedPatientIds = null;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'tenant_id',
        'name',
        'email',
        'phone',
        'password',
        'is_active',
    ];

    /**
     * Defaults applied in PHP as well as in the schema.
     *
     * A database default only applies on INSERT: the in-memory instance stays
     * null, and a null is_active reads as "inactive" to the authorisation
     * helpers -- which silently denied every request.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'is_active' => true,
    ];

    /**
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',

        /*
         * The TOTP secret, on the same list as the password and for a stronger
         * reason.
         *
         * A password digest is useless to whoever reads it; a TOTP secret is the
         * factor itself, and anyone holding it can generate the operator's codes
         * for ever. It is written through the `encrypted` cast, it is never
         * returned after enrolment -- the one response that shows a secret shows
         * the one that was just generated, not one read back out of a row -- and
         * this line is what keeps it out of a `toArray()`, a `dd($user)` or a
         * resource somebody adds later without thinking about it.
         *
         * This is the write-only discipline the aggregator credentials are held
         * to, applied to the credential that guards the account which can grant
         * break-glass access to a clinic's records.
         */
        'totp_secret_encrypted',
    ];

    /**
     * password_change_required_at is timestamptz.
     *
     * Laravel's default format is naive ('Y-m-d H:i:s'), so PostgreSQL resolves
     * the missing offset in the SESSION's timezone rather than the application's,
     * and the instant stored depends on how the database server happens to be
     * configured.
     *
     * Columns declared without a timezone ignore the offset, so email_verified_at,
     * phone_verified_at, created_at and updated_at are unaffected.
     *
     * totp_confirmed_at is timestamptz too, and is covered by the same format.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'phone_verified_at' => 'datetime',
            'password_change_required_at' => 'datetime',
            'password' => 'hashed',
            'phone' => PhoneNumber::class,
            'is_active' => 'boolean',

            /*
             * The second factor.
             *
             * `encrypted` and not `hashed`: a password only ever has to be
             * COMPARED, so a one-way digest is the right shape for it, but a
             * TOTP secret has to be READ back to recompute the six digits the
             * operator's authenticator is showing. Encryption under APP_KEY is
             * what keeps it out of a database dump while leaving the
             * verification path able to do its job.
             *
             * `totp_confirmed_at` is datetime rather than a boolean so the
             * column can answer "since when". `totp_last_used_step` is the
             * replay high-water mark -- cast to integer because it is compared
             * with, and advanced past, a computed step number, and PostgreSQL
             * hands a bigint back as a string on some drivers.
             *
             * @see docs/40-api/authentication-and-sessions.md § Second factor
             */
            'totp_secret_encrypted' => 'encrypted',
            'totp_confirmed_at' => 'datetime',
            'totp_last_used_step' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Tenant, $this>
     */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * The patient records this account may read as its own.
     *
     * Many, not one. A guardian holds their children's records -- patient
     * consents are marked `P, guardian` in the endpoint catalogue, and the DPPA's
     * special provisions require guardian consent for minors.
     *
     * @return HasMany<Patient, $this>
     */
    public function patients(): HasMany
    {
        return $this->hasMany(Patient::class);
    }

    /**
     * The ids of the patient records this account owns.
     *
     * Memoised for the request. Authorising a patient-facing read consults this
     * on every row and every index query, so the alternative is one query per
     * check on the hottest path in the patient app.
     *
     * @return list<string>
     */
    public function ownedPatientIds(): array
    {
        return $this->ownedPatientIds ??= array_values(
            $this->patients()
                ->pluck('id')
                ->map(fn (mixed $id) => (string) $id)
                ->all()
        );
    }

    /**
     * Whether this account owns the named patient record.
     *
     * A null id is never owned. Passing one means the caller could not establish
     * whose record it is, and the safe answer to that is no.
     */
    public function owns(?string $patientId): bool
    {
        return $patientId !== null && in_array($patientId, $this->ownedPatientIds(), true);
    }

    /**
     * Whether this account is still using a password somebody else chose.
     *
     * True only on the staff-issued patient path: clinic staff create the
     * account at the registration desk and read the initial password aloud, so
     * for as long as it stands a second person knows it. RequirePasswordChange
     * refuses everything but the password change until this is discharged, which
     * matters because consent is the patient role's alone -- a staff member
     * signing in with the credential they issued could forge a consent decision
     * that the audit trail would attribute to the patient.
     *
     * Invited staff choose their own password when they accept, so they never
     * carry this.
     */
    public function mustChangePassword(): bool
    {
        return $this->password_change_required_at !== null;
    }

    public function isPlatformUser(): bool
    {
        return $this->tenant_id === null;
    }

    public function belongsToTenant(string $tenantId): bool
    {
        return $this->tenant_id === $tenantId;
    }
}
