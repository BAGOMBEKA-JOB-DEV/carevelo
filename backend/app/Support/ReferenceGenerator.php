<?php

namespace App\Support;

use App\Tenancy\TenantContext;
use Illuminate\Database\DatabaseManager;
use Illuminate\Support\Facades\Date;

/**
 * Generates short, tenant-scoped human references: APT-2608-0147.
 *
 * ULIDs are the primary keys, but they are unpronounceable over a phone call —
 * which is how most support in this market actually happens. References are
 * what a clinic and a patient say aloud.
 *
 * Unique within a tenant, not globally: two clinics may both have APT-2608-0001
 * and never see each other's. A tenant-local sequence is what keeps the number
 * short enough to read out.
 *
 * @see docs/20-domain/identifiers-and-numbering.md
 */
class ReferenceGenerator
{
    public function __construct(
        protected DatabaseManager $db,
        protected TenantContext $context,
    ) {}

    /**
     * @param  string  $prefix  APT, RX, DLV, PAY
     */
    public function next(string $prefix): string
    {
        $tenantId = $this->context->currentOrFail();
        $period = Date::now()->format('ym');

        // SELECT ... FOR UPDATE. Under Carevelo's write volumes the lock is not
        // a bottleneck, and gap-free-ish numbering is worth it. Gaps are still
        // acceptable — a rolled back transaction consumes a number — so no
        // reconciliation logic may assume contiguity.
        $sequence = $this->db->connection()->transaction(function () use ($tenantId, $prefix, $period): int {
            $row = $this->db->connection()
                ->table('reference_sequences')
                ->where('tenant_id', $tenantId)
                ->where('prefix', $prefix)
                ->where('period', $period)
                ->lockForUpdate()
                ->first();

            if ($row === null) {
                $this->db->connection()->table('reference_sequences')->insert([
                    'tenant_id' => $tenantId,
                    'prefix' => $prefix,
                    'period' => $period,
                    'next_value' => 2,
                ]);

                return 1;
            }

            $this->db->connection()
                ->table('reference_sequences')
                ->where('tenant_id', $tenantId)
                ->where('prefix', $prefix)
                ->where('period', $period)
                ->update(['next_value' => $row->next_value + 1]);

            return (int) $row->next_value;
        });

        return sprintf('%s-%s-%04d', $prefix, $period, $sequence);
    }
}
