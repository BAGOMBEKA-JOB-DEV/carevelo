<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\User;
use App\Models\WorkingHour;
use App\Support\Money;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| The clinic's catalogue, and the clinic's timetable
|--------------------------------------------------------------------------
|
| Three invariants are load-bearing here and each has its own test.
|
| Prices are per-tenant integer minor units. There is no platform price list,
| and a float price is rejected rather than rounded.
|
| DELETE deactivates. It never deletes -- historical appointments reference the
| row, and a clinic may have to produce that history years later.
|
| Patients see only active services; staff see everything.
|
| Every fixture and every assertion touching tenant data runs inside
| Tenancy::run(). Outside it row-level security correctly hides the rows, and a
| test asserting on an empty result set asserts nothing.
|
| @see docs/10-product/prd-h1-clinic-onboarding.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function catalogueUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A clinic with an administrator, a front-desk user and a patient user.
 *
 * @return array{tenant: Tenant, admin: User, frontDesk: User, patientUser: User}
 */
function catalogueFixture(): array
{
    $tenant = Tenant::factory()->create();

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $staff = function (ClinicalRole $role) use ($tenant): User {
            $user = User::factory()->create(['tenant_id' => $tenant->id]);
            $user->assignRole($role->value);

            return $user;
        };

        return [
            'tenant' => $tenant,
            'admin' => $staff(ClinicalRole::ClinicAdmin),
            'frontDesk' => $staff(ClinicalRole::FrontDesk),
            'patientUser' => $staff(ClinicalRole::Patient),
        ];
    });
}

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function servicePayload(array $overrides = []): array
{
    return array_merge([
        'name' => 'General Consultation',
        'description' => 'A standard appointment with a general practitioner.',
        'duration_minutes' => 30,
        // 30,000 shillings, in minor units.
        'price_minor' => 3_000_000,
        'currency' => 'UGX',
        'modes' => ['video', 'voice', 'chat'],
    ], $overrides);
}

it('prices a service in integer minor units set by the clinic itself', function () {
    // There is no platform price list. Two clinics may charge whatever they
    // charge, and the figure travels as an integer plus an explicit currency --
    // never a decimal a client might parse into a float.
    $f = catalogueFixture();

    $this->actingAs($f['admin'])
        ->postJson(catalogueUrl($f['tenant'], '/api/v1/services'), servicePayload([
            'price_minor' => 4_500_000,
        ]))
        ->assertCreated()
        ->assertJsonPath('data.price.amount_minor', 4_500_000)
        ->assertJsonPath('data.price.currency', 'UGX');

    app(Tenancy::class)->run($f['tenant']->id, function () {
        $service = Service::query()->firstOrFail();

        expect($service->price)->toBeInstanceOf(Money::class)
            ->and($service->price->amountMinor)->toBe(4_500_000)
            ->and($service->price->amountMinor)->toBeInt();
    });
});

it('lets two clinics price the same service differently', function () {
    // The point of a per-tenant price: nothing is shared, and neither figure is
    // a deviation from a platform default that does not exist.
    $first = catalogueFixture();
    $second = catalogueFixture();

    $this->actingAs($first['admin'])
        ->postJson(catalogueUrl($first['tenant'], '/api/v1/services'), servicePayload(['price_minor' => 2_000_000]))
        ->assertCreated();

    $this->actingAs($second['admin'])
        ->postJson(catalogueUrl($second['tenant'], '/api/v1/services'), servicePayload(['price_minor' => 9_000_000]))
        ->assertCreated();

    $this->actingAs($first['admin'])
        ->getJson(catalogueUrl($first['tenant'], '/api/v1/services'))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.price.amount_minor', 2_000_000);
});

it('refuses a price expressed as a float', function () {
    // Money that has been through a float cannot be proven correct afterwards,
    // so the rejection happens at the edge rather than being rounded away.
    $f = catalogueFixture();

    $this->actingAs($f['admin'])
        ->postJson(catalogueUrl($f['tenant'], '/api/v1/services'), servicePayload([
            'price_minor' => 15000.75,
        ]))
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonStructure(['errors' => ['price_minor']]);
});

it('changes a price without touching anything else', function () {
    $f = catalogueFixture();

    $created = $this->actingAs($f['admin'])
        ->postJson(catalogueUrl($f['tenant'], '/api/v1/services'), servicePayload())
        ->assertCreated();

    $id = $created->json('data.id');

    $this->actingAs($f['admin'])
        ->putJson(catalogueUrl($f['tenant'], "/api/v1/services/{$id}"), ['price_minor' => 6_000_000])
        ->assertOk()
        ->assertJsonPath('data.price.amount_minor', 6_000_000)
        ->assertJsonPath('data.name', 'General Consultation')
        ->assertJsonPath('data.duration_minutes', 30);
});

it('leaves the price alone when an update does not mention it', function () {
    // An absent field must not read as zero: a clinic renaming a service would
    // otherwise make it free.
    $f = catalogueFixture();

    $created = $this->actingAs($f['admin'])
        ->postJson(catalogueUrl($f['tenant'], '/api/v1/services'), servicePayload())
        ->assertCreated();

    $this->actingAs($f['admin'])
        ->putJson(
            catalogueUrl($f['tenant'], "/api/v1/services/{$created->json('data.id')}"),
            ['name' => 'GP Consultation']
        )
        ->assertOk()
        ->assertJsonPath('data.name', 'GP Consultation')
        ->assertJsonPath('data.price.amount_minor', 3_000_000);
});

it('deactivates on DELETE instead of deleting the row', function () {
    // THE test for this endpoint. Appointments, and through them consultations
    // and prescriptions, carry a service_id. A hard delete orphans all of them,
    // and a clinic asked to produce last year's bookings would find a reference
    // resolving to nothing.
    $f = catalogueFixture();

    $created = $this->actingAs($f['admin'])
        ->postJson(catalogueUrl($f['tenant'], '/api/v1/services'), servicePayload())
        ->assertCreated();

    $id = $created->json('data.id');

    $this->actingAs($f['admin'])
        ->deleteJson(catalogueUrl($f['tenant'], "/api/v1/services/{$id}"))
        ->assertOk()
        ->assertJsonPath('data.is_active', false);

    app(Tenancy::class)->run($f['tenant']->id, function () use ($id) {
        // firstOrFail is the survival assertion: the row is still there.
        $service = Service::query()->whereKey($id)->firstOrFail();

        expect($service->is_active)->toBeFalse()
            ->and(Service::query()->count())->toBe(1);
    });
});

it('audits a deactivation without naming the service', function () {
    $f = catalogueFixture();

    $created = $this->actingAs($f['admin'])
        ->postJson(catalogueUrl($f['tenant'], '/api/v1/services'), servicePayload([
            'name' => 'Antenatal Review',
        ]))
        ->assertCreated();

    $this->actingAs($f['admin'])
        ->deleteJson(catalogueUrl($f['tenant'], "/api/v1/services/{$created->json('data.id')}"))
        ->assertOk();

    app(Tenancy::class)->run($f['tenant']->id, function () {
        $event = AuditEvent::query()->where('action', 'service.deactivated')->firstOrFail();

        // A service name is health information about whoever books it. The
        // audit log records that something happened to which record, never
        // what the record said.
        expect(json_encode($event->metadata))->not->toContain('Antenatal');
    });
});

it('shows a patient only the active services', function () {
    $f = catalogueFixture();

    app(Tenancy::class)->run($f['tenant']->id, function () {
        Service::factory()->create(['name' => 'Live Service']);
        Service::factory()->create(['name' => 'Withdrawn Service', 'is_active' => false]);
    });

    $this->actingAs($f['patientUser'])
        ->getJson(catalogueUrl($f['tenant'], '/api/v1/services'))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.name', 'Live Service');
});

it('shows staff every service, withdrawn ones included', function () {
    $f = catalogueFixture();

    app(Tenancy::class)->run($f['tenant']->id, function () {
        Service::factory()->create(['name' => 'Live Service']);
        Service::factory()->create(['name' => 'Withdrawn Service', 'is_active' => false]);
    });

    $this->actingAs($f['frontDesk'])
        ->getJson(catalogueUrl($f['tenant'], '/api/v1/services'))
        ->assertOk()
        ->assertJsonCount(2, 'data');
});

it('refuses catalogue writes to anyone but the administrator', function () {
    // Denial is the half that catches privilege escalation. A price is a
    // commercial commitment to a patient.
    $f = catalogueFixture();

    $service = app(Tenancy::class)->run($f['tenant']->id, fn () => Service::factory()->create());

    $this->actingAs($f['frontDesk'])
        ->postJson(catalogueUrl($f['tenant'], '/api/v1/services'), servicePayload())
        ->assertForbidden();

    $this->actingAs($f['patientUser'])
        ->putJson(catalogueUrl($f['tenant'], "/api/v1/services/{$service->id}"), ['price_minor' => 1])
        ->assertForbidden();

    $this->actingAs($f['frontDesk'])
        ->deleteJson(catalogueUrl($f['tenant'], "/api/v1/services/{$service->id}"))
        ->assertForbidden();
});

it('rejects a body field the endpoint does not know about', function () {
    $f = catalogueFixture();

    $this->actingAs($f['admin'])
        ->postJson(catalogueUrl($f['tenant'], '/api/v1/services'), servicePayload([
            'tenant_id' => $f['tenant']->id,
        ]))
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['tenant_id']]);
});

it('returns 404 for a service belonging to another clinic', function () {
    // Not 403. A 403 would confirm the id exists somewhere.
    $f = catalogueFixture();

    $other = Tenant::factory()->create();
    $foreign = app(Tenancy::class)->run($other->id, fn () => Service::factory()->create());

    $this->actingAs($f['admin'])
        ->deleteJson(catalogueUrl($f['tenant'], "/api/v1/services/{$foreign->id}"))
        ->assertNotFound();
});

it('stores one row per day of the week, Sunday numbered zero', function () {
    $f = catalogueFixture();

    $this->actingAs($f['admin'])
        ->putJson(catalogueUrl($f['tenant'], '/api/v1/working-hours'), [
            'days' => [
                ['day_of_week' => 0, 'is_closed' => true],
                ['day_of_week' => 1, 'opens_at' => '08:00', 'closes_at' => '17:00'],
                ['day_of_week' => 6, 'opens_at' => '09:00', 'closes_at' => '13:00'],
            ],
        ])
        ->assertOk()
        ->assertJsonCount(3, 'data')
        ->assertJsonPath('data.0.day_of_week', 0)
        ->assertJsonPath('data.0.day', 'sunday')
        ->assertJsonPath('data.0.is_closed', true)
        ->assertJsonPath('data.1.day', 'monday')
        ->assertJsonPath('data.1.opens_at', '08:00')
        ->assertJsonPath('data.1.closes_at', '17:00')
        ->assertJsonPath('data.2.day', 'saturday');

    app(Tenancy::class)->run($f['tenant']->id, function () {
        expect(WorkingHour::query()->count())->toBe(3)
            ->and(WorkingHour::query()->where('day_of_week', 1)->count())->toBe(1);
    });
});

it('replaces the whole week, dropping a day the clinic no longer opens', function () {
    // PUT on a collection: absence means removal. A merge would leave last
    // season's Saturday published, and a patient would arrive to a locked door.
    $f = catalogueFixture();

    $url = catalogueUrl($f['tenant'], '/api/v1/working-hours');

    $this->actingAs($f['admin'])->putJson($url, [
        'days' => [
            ['day_of_week' => 1, 'opens_at' => '08:00', 'closes_at' => '17:00'],
            ['day_of_week' => 6, 'opens_at' => '09:00', 'closes_at' => '13:00'],
        ],
    ])->assertOk();

    $this->actingAs($f['admin'])->putJson($url, [
        'days' => [
            ['day_of_week' => 1, 'opens_at' => '08:00', 'closes_at' => '17:00'],
        ],
    ])->assertOk()->assertJsonCount(1, 'data');

    $this->actingAs($f['admin'])->getJson($url)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.day_of_week', 1);
});

it('refuses a closing time that is not after the opening time', function () {
    $f = catalogueFixture();

    $this->actingAs($f['admin'])
        ->putJson(catalogueUrl($f['tenant'], '/api/v1/working-hours'), [
            'days' => [
                ['day_of_week' => 2, 'opens_at' => '17:00', 'closes_at' => '08:00'],
            ],
        ])
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['days.0.closes_at']]);
});

it('accepts a day with no hours at all when it is marked closed', function () {
    // The ordering rule is suspended, not the row: the columns are NOT NULL and
    // nothing reads them while is_closed is true.
    $f = catalogueFixture();

    $this->actingAs($f['admin'])
        ->putJson(catalogueUrl($f['tenant'], '/api/v1/working-hours'), [
            'days' => [['day_of_week' => 0, 'is_closed' => true]],
        ])
        ->assertOk()
        ->assertJsonPath('data.0.is_closed', true);
});

it('refuses the same day twice in one body', function () {
    $f = catalogueFixture();

    $this->actingAs($f['admin'])
        ->putJson(catalogueUrl($f['tenant'], '/api/v1/working-hours'), [
            'days' => [
                ['day_of_week' => 1, 'opens_at' => '08:00', 'closes_at' => '12:00'],
                ['day_of_week' => 1, 'opens_at' => '13:00', 'closes_at' => '17:00'],
            ],
        ])
        ->assertStatus(422);
});

it('refuses a day number outside Sunday to Saturday', function () {
    $f = catalogueFixture();

    $this->actingAs($f['admin'])
        ->putJson(catalogueUrl($f['tenant'], '/api/v1/working-hours'), [
            'days' => [['day_of_week' => 7, 'opens_at' => '08:00', 'closes_at' => '17:00']],
        ])
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['days.0.day_of_week']]);
});

it('refuses the timetable to anyone but the administrator, and to patients entirely', function () {
    $f = catalogueFixture();

    $this->actingAs($f['frontDesk'])
        ->putJson(catalogueUrl($f['tenant'], '/api/v1/working-hours'), [
            'days' => [['day_of_week' => 1, 'opens_at' => '08:00', 'closes_at' => '17:00']],
        ])
        ->assertForbidden();

    // Front desk books into the timetable, so it reads it.
    $this->actingAs($f['frontDesk'])
        ->getJson(catalogueUrl($f['tenant'], '/api/v1/working-hours'))
        ->assertOk();

    // A patient asks /availability instead, which answers the question they
    // actually have.
    $this->actingAs($f['patientUser'])
        ->getJson(catalogueUrl($f['tenant'], '/api/v1/working-hours'))
        ->assertForbidden();
});

it('keeps one clinic\'s timetable invisible to another', function () {
    $f = catalogueFixture();
    $other = catalogueFixture();

    $this->actingAs($f['admin'])
        ->putJson(catalogueUrl($f['tenant'], '/api/v1/working-hours'), [
            'days' => [['day_of_week' => 1, 'opens_at' => '08:00', 'closes_at' => '17:00']],
        ])
        ->assertOk();

    $this->actingAs($other['admin'])
        ->getJson(catalogueUrl($other['tenant'], '/api/v1/working-hours'))
        ->assertOk()
        ->assertJsonCount(0, 'data');
});
