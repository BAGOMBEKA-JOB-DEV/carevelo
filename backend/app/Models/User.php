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
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'phone_verified_at' => 'datetime',
            'password' => 'hashed',
            'phone' => PhoneNumber::class,
            'is_active' => 'boolean',
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

    public function isPlatformUser(): bool
    {
        return $this->tenant_id === null;
    }

    public function belongsToTenant(string $tenantId): bool
    {
        return $this->tenant_id === $tenantId;
    }
}
