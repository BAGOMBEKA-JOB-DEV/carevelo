<?php

namespace Database\Seeders;

use App\Models\ClinicalRole;
use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Role;

/**
 * The seven tenant roles and three platform roles.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class RoleSeeder extends Seeder
{
    public function run(): void
    {
        foreach (ClinicalRole::cases() as $role) {
            Role::findOrCreate($role->value, 'web');
        }
    }
}
