<?php

namespace App\Models;

use Database\Factories\BreakGlassGrantFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;
use LogicException;

/**
 * The only route by which a Carevelo operator reaches tenant clinical data.
 *
 * Each clinic is the data CONTROLLER and we process on its instruction, so
 * reading its records without a recorded reason is processing without one. Four
 * things are therefore load-bearing rather than decorative, and permits()
 * requires all of them: a REASON, a SCOPE, a TIME BOX, and the fact that the
 * TENANT WAS TOLD.
 *
 * Platform-scoped: this row is a cross-tenant control surface, so it carries no
 * RLS policy and is readable from the platform routes where no tenant is bound.
 * That is also why reaching the tenant's own rows under a grant needs
 * Tenancy::run() — see App\Services\Platform\BreakGlassAccess.
 *
 * @see docs/50-security-compliance/rbac-matrix.md break-glass section
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $operator_id
 * @property string $reason
 * @property string $scope
 * @property Carbon $granted_at
 * @property Carbon $expires_at
 * @property ?Carbon $revoked_at
 * @property ?Carbon $tenant_notified_at
 */
class BreakGlassGrant extends Model
{
    /** @use HasFactory<BreakGlassGrantFactory> */
    use HasFactory;

    use HasUlids;

    /**
     * The longest time box any grant may carry.
     *
     * A grant that outlives the incident it was opened for is standing access
     * wearing an exception's costume. Longer investigations issue a second
     * grant, which is notified and audited again — the friction is the control.
     */
    public const MAX_DURATION_HOURS = 24;

    /**
     * The scopes a grant may state, as a closed list.
     *
     * Free text would make the scope unenforceable: permits() compares the
     * requested scope against the granted one, and a comparison against prose
     * always succeeds or always fails.
     *
     * @var list<string>
     */
    public const SCOPES = [
        'patient_record',
        'consultation',

        /*
         * A SCOPE OF ITS OWN, AND THE ALTERNATIVE WAS FOLDING CHAT INTO
         * `consultation`. That would have been wrong, and quietly so.
         *
         * This list already draws exactly this distinction once: `consultation`
         * is the encounter as an operational record -- who, when, in which mode,
         * with what outcome -- and `clinical_note` is the text written inside
         * it. The split exists because they are different disclosures, and the
         * commonest real grant is the first: a support ticket saying "the clinic
         * cannot open a record". An operator investigating that needs the
         * encounter, not what the patient told their doctor.
         *
         * A chat message is text authored inside the encounter, so folding it
         * into `consultation` would have made every scheduling-bug grant
         * silently unlock a transcript, which is the precise failure the
         * note/consultation split was drawn to prevent. Folding it into
         * `clinical_note` would be closer but still wrong in the place it costs
         * most: the clinic is TOLD the scope, and permits() compares against it,
         * so a grant that says "clinical_note" and reads a conversation has
         * misdescribed itself to the controller whose consent makes it lawful.
         *
         * The cost of the honest choice is that an investigation needing both
         * needs two grants, each notified and audited. The friction is the
         * control -- MAX_DURATION_HOURS says the same thing above.
         */
        'consultation_message',

        'clinical_note',
        'prescription',
        'dispensing',
        'delivery',
        'payment',
        'audit_trail',
    ];

    /**
     * revoked_at and tenant_notified_at are deliberately absent.
     *
     * Neither is a client's to supply: notification is performed by the issuing
     * service, and a request that could stamp tenant_notified_at itself would
     * turn the clinic's right to know into an optional field.
     *
     * @var list<string>
     */
    protected $fillable = [
        'tenant_id',
        'operator_id',
        'reason',
        'scope',
        'granted_at',
        'expires_at',
    ];

    /**
     * Timestamps are written WITH their offset.
     *
     * These columns are timestamptz and Laravel's default format is naive
     * ('Y-m-d H:i:s'), so PostgreSQL resolves the missing offset using the
     * session's TimeZone — which is not the application's. The result is a
     * silent shift of a few hours in whichever direction the deployment
     * happens to be configured, and the value that shifts here is a TIME BOX:
     * a grant would expire early or, far worse, late.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /** Fixed once issued, except for ending it early and recording notification. */
    protected static function booted(): void
    {
        static::updating(function (self $grant): void {
            $mutable = ['revoked_at', 'tenant_notified_at', 'updated_at'];

            $illegal = array_diff(array_keys($grant->getDirty()), $mutable);

            if ($illegal !== []) {
                throw new LogicException(sprintf(
                    'A break-glass grant is fixed once issued; cannot change [%s]. '
                    .'Widening a scope or extending a time box means issuing a new '
                    .'grant, which is notified to the clinic and audited in its own right.',
                    implode(', ', $illegal)
                ));
            }
        });
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'granted_at' => 'datetime',
            'expires_at' => 'datetime',
            'revoked_at' => 'datetime',
            'tenant_notified_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** @return BelongsTo<User, $this> */
    public function operator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'operator_id');
    }

    public function hasExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    public function isRevoked(): bool
    {
        return $this->revoked_at !== null;
    }

    public function wasTenantNotified(): bool
    {
        return $this->tenant_notified_at !== null;
    }

    /**
     * Whether this grant permits access to $scope right now.
     *
     * Notification is one of the conditions, not a follow-up courtesy: a grant
     * the controller has not been told about is not a grant, so an unnotified
     * one permits nothing.
     */
    public function permits(string $scope): bool
    {
        return $this->scope === $scope
            && $this->wasTenantNotified()
            && ! $this->isRevoked()
            && ! $this->hasExpired();
    }

    /** End the grant before its time box elapses. */
    public function revoke(): void
    {
        $this->revoked_at = Date::now();
        $this->save();
    }

    /**
     * Grants that are live: notified, unrevoked and inside their time box.
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeActive(Builder $query): Builder
    {
        return $query
            ->whereNotNull('tenant_notified_at')
            ->whereNull('revoked_at')
            // An offset-bearing string, not a Carbon: the query grammar renders
            // a bound date naively, which PostgreSQL would then read in the
            // session's own timezone rather than the application's.
            ->where('expires_at', '>', Date::now()->toIso8601String());
    }
}
