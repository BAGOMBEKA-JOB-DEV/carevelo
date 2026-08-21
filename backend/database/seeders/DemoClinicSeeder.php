<?php

namespace Database\Seeders;

use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Patient;
use App\Models\PatientStatus;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Models\User;
use App\Models\WorkingHour;
use App\Support\Auth\PatientRecordClaims;
use App\Tenancy\Tenancy;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Date;

/**
 * One clinic, enough people to sign in as, for local development.
 *
 * Reachable at `kira.localhost` when APP_URL is `http://localhost` — the tenant is
 * resolved from the host by ResolveTenant, and `*.localhost` resolves to 127.0.0.1
 * without touching /etc/hosts.
 *
 * LOCAL ONLY. It refuses to run in any other environment: it creates accounts with
 * known phone numbers, and a known account on a production health system is a way in.
 *
 * Everything tenant-scoped is written inside Tenancy::run. Not a nicety — the tables
 * carry FORCE ROW LEVEL SECURITY, so a seeder writing outside a tenant context is
 * refused by the database rather than silently misfiling the row.
 */
class DemoClinicSeeder extends Seeder
{
    public const SUBDOMAIN = 'kira';

    /**
     * The patient you can sign in as -- by ADDRESS, with no number on the account.
     *
     * That is not an omission. A real patient account is created at the
     * registration desk by POST /v1/patients/{patient}/account, which writes no
     * `users.phone` at all: the column is unique per clinic, and a member of
     * staff who is also a patient there -- or a record registered against a
     * next-of-kin number -- would collide. The demo matches the product, so the
     * portal is exercised the way patients will actually reach it.
     */
    public const PATIENT_EMAIL = 'aisha-nambooze@kira.test';

    /** The number that patient's clinical RECORD is registered against. */
    public const PATIENT_PHONE = '+256772000001';

    /** Clinic staff: an administrator and a clinician. */
    public const ADMIN_PHONE = '+256772000002';

    public const CLINICIAN_PHONE = '+256772000003';

    public function run(): void
    {
        if (! app()->environment('local')) {
            $this->command->error('DemoClinicSeeder is local-only: it creates accounts with known credentials.');

            return;
        }

        $this->call(RoleSeeder::class);

        $tenant = Tenant::query()->firstWhere('subdomain', self::SUBDOMAIN)
            ?? Tenant::query()->create([
                'slug' => self::SUBDOMAIN,
                'subdomain' => self::SUBDOMAIN,
                'legal_name' => 'Kira Health Services Limited',
                'trading_name' => 'Kira Family Clinic',
                'status' => TenantStatus::Active,
                'timezone' => 'Africa/Kampala',
                'currency' => 'UGX',
                // A real brand, so the white-label path is exercised rather than
                // falling back to Carevelo's own colours. Deep green: the computed
                // foreground for it is white.
                'primary_colour' => '#1B7F5A',
                'secondary_colour' => '#0A2540',
                'contact_phone' => '+256414000000',
                'contact_email' => 'reception@kira.test',
                'physical_address' => 'Plot 14, Ntinda Road',
                'district' => 'Kampala',
            ]);

        app(Tenancy::class)->run($tenant->id, function () use ($tenant): void {
            $admin = $this->account($tenant, 'Sarah Nakato', ClinicalRole::ClinicAdmin, self::ADMIN_PHONE);
            $clinicianUser = $this->account($tenant, 'Dr Ronald Okello', ClinicalRole::Clinician, self::CLINICIAN_PHONE);
            $patientUser = $this->account($tenant, 'Aisha Nambooze', ClinicalRole::Patient);

            Clinician::query()->firstOrCreate(
                ['user_id' => $clinicianUser->id],
                [
                    'registration_body' => 'UMDPC',
                    'registration_number' => 'UMDPC-04412',
                    'can_prescribe' => true,
                ],
            );

            Service::query()->firstOrCreate(
                ['name' => 'General Consultation'],
                [
                    'duration_minutes' => 30,
                    // Minor units. UGX 30,000.
                    'price_minor' => 3_000_000,
                    'currency' => 'UGX',
                    'is_active' => true,
                ],
            );

            // Monday to Saturday, 08:00-17:00. Sunday closed, which the availability
            // endpoint reads as no slots rather than as an error.
            foreach (range(0, 6) as $day) {
                WorkingHour::query()->firstOrCreate(
                    ['day_of_week' => $day],
                    [
                        'opens_at' => '08:00:00',
                        'closes_at' => '17:00:00',
                        'is_closed' => $day === 0,
                    ],
                );
            }

            // The patient's clinical record. Front desk would have registered this
            // first, from a walk-in with no login at all, and then created the
            // account against it at the desk -- which is the only path there is.
            $patient = Patient::query()->firstOrCreate(
                ['phone' => self::PATIENT_PHONE],
                [
                    'given_name' => 'Aisha',
                    'family_name' => 'Nambooze',
                    'date_of_birth' => '1994-03-11',
                    'sex' => 'female',
                    'district' => 'Kampala',
                    'status' => PatientStatus::Active,
                    'phone_verified_at' => Date::now(),
                ],
            );

            // Linked here so the seeded portal has records to show immediately.
            // In the product this is what POST /v1/patients/{patient}/account does
            // in the same transaction that creates the login; the seeder skips the
            // account creation because the account already exists above, but the
            // link is the same call and the same audit event.
            if (! $patient->isClaimed()) {
                app(PatientRecordClaims::class)->attachRecord($patientUser->fresh() ?? $patientUser, $patient);
            }

            $this->command->info(sprintf('Clinic: %s at %s.localhost', $tenant->trading_name, self::SUBDOMAIN));
            $this->command->info(sprintf('  patient    %s  (%s, record %s)', self::PATIENT_EMAIL, $patientUser->name, $patient->id));
            $this->command->info(sprintf('  admin      %s  (%s)', self::ADMIN_PHONE, $admin->name));
            $this->command->info(sprintf('  clinician  %s  (%s)', self::CLINICIAN_PHONE, $clinicianUser->name));
            $this->command->info('Every account signs in at POST /api/v1/auth/sign-in with the password "demo-password".');
            $this->command->info(
                'Staff sign in with either their number or their address; a patient has only an '
                .'address, because a real patient account is created for them at the registration '
                .'desk by POST /api/v1/patients/{patient}/account and is never given a phone.'
            );
        });
    }

    /**
     * One account, keyed on the address because that is the identifier everybody has.
     *
     * The number is optional and staff-only. Patient accounts are created at the
     * registration desk and never carry one; staff accounts get theirs from the
     * SMS invitation that proved the handset, which is also the only thing that
     * legitimately sets phone_verified_at.
     */
    private function account(Tenant $tenant, string $name, ClinicalRole $role, ?string $phone = null): User
    {
        $user = User::query()->firstOrCreate(
            ['tenant_id' => $tenant->id, 'email' => str($name)->slug().'@kira.test'],
            [
                'name' => $name,
                'phone' => $phone,
                // One way in for everybody, patients included: an identifier and a
                // password. Staff may use either identifier; a patient has only
                // the address.
                'password' => 'demo-password',
                'is_active' => true,
                'phone_verified_at' => $phone === null ? null : Date::now(),
            ],
        );

        if (! $user->hasRole($role->value)) {
            $user->assignRole($role->value);
        }

        return $user;
    }
}
