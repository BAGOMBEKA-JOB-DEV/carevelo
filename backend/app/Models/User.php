<?php

namespace App\Models;

use App\Support\PhoneNumber;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Spatie\Permission\Traits\HasRoles;

/**
 * A staff member — clinic or platform.
 *
 * Clinic staff belong to exactly one tenant. There is no cross-tenant staff
 * identity: someone working at two clinics has two accounts, which follows
 * directly from the isolation boundary.
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
    use Notifiable;

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

    public function isPlatformUser(): bool
    {
        return $this->tenant_id === null;
    }

    public function belongsToTenant(string $tenantId): bool
    {
        return $this->tenant_id === $tenantId;
    }
}
