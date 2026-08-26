<?php

use App\Models\ClinicalRole;
use App\Models\Delivery;
use App\Models\DeliveryStatus;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Carbon\CarbonInterface;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| The rider disclosure window
|--------------------------------------------------------------------------
|
| `GET /v1/rider/deliveries?status=completed` is the only place in the product
| where the least-trusted actor in the system reads back work that is already
| finished, and it is therefore a disclosure decision rather than a feature.
| Every row it returns carries a named person's telephone number and the street
| address where their medicines were taken, and the fact that a named person
| received a delivery from a named clinic is itself health data under DPPA 2019
| whether or not a medicine is named.
|
| Two rules make that survivable, and this file exists because a rule with no
| test is a rule until somebody refactors:
|
|   1. A BOUND IN TIME. `RiderDeliveryController::COMPLETED_WINDOW_HOURS` is 72
|      — a full working day plus the day either side, so a Saturday round is
|      readable on Monday and a Friday dispute survives a weekend, while a rider
|      who leaves the clinic's arrangement holds nothing readable within the
|      working week. Without it a rider's personal handset becomes a standing,
|      exportable list of a clinic's patients and where they live, growing for
|      as long as the account exists.
|   2. A BOUND IN OWNERSHIP. `rider_id` comes from the SESSION, so there is no
|      query a client could write that returns another rider's work.
|
| THE TWO SURFACES ARE TESTED TOGETHER ON PURPOSE. The listing decides what a
| rider may DISCOVER; `show` decides what they may still READ with an identifier
| they wrote down yesterday. If those two ever disagree, only the weaker one is
| true — so each rule below is asserted against both.
|
| ACTIVE WORK IS NOT BOUNDED BY EITHER, and that has a test too. A package that
| disappeared from a rider's round because it aged out is a package nobody
| delivers, which is a worse failure than the one the window prevents.
|
| Every fixture and every assertion runs inside Tenancy::run(). Outside it,
| row-level security correctly hides the rows and an assertion would pass by
| seeing nothing at all.
|
| @see backend/app/Http/Controllers/Api/V1/RiderDeliveryController.php
| @see backend/app/Http/Requests/V1/Rider/RiderAssignmentsRequest.php
| @see docs/50-security-compliance/data-protection-dppa.md — "The rider rule"
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

afterEach(function () {
    // The fixtures below travel in time to age a delivery. A test that left the
    // clock moved would silently poison every test that ran after it.
    Date::setTestNow();
});

function riderUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function riderOf(Tenant $tenant): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $rider = User::factory()->create(['tenant_id' => $tenant->id]);
        $rider->assignRole(ClinicalRole::Rider->value);

        return $rider;
    });
}

/**
 * A delivery this rider carried and completed at a given moment.
 *
 * THE CLOCK IS MOVED RATHER THAN THE COLUMN WRITTEN, and that is the point of
 * the helper. `updated_at` is what the window is measured against — deliberately,
 * because two of the three settled states never set `delivered_at` and filtering
 * on a null column would return an empty list for exactly the rows a rider most
 * needs — and it is maintained by Eloquent on save(). Setting it by hand would
 * test a column this code does not actually write; travelling to the moment and
 * performing the real transitions tests the thing that happens in production.
 */
function riderCompletedDelivery(Tenant $tenant, User $rider, CarbonInterface $settledAt): Delivery
{
    return app(Tenancy::class)->run($tenant->id, function () use ($rider, $settledAt) {
        Date::setTestNow($settledAt);

        $delivery = Delivery::factory()->create();
        $delivery->assignTo($rider->id);
        $delivery->transitionTo(DeliveryStatus::PickedUp);
        $delivery->transitionTo(DeliveryStatus::EnRoute);
        $delivery->transitionTo(DeliveryStatus::Delivered);

        Date::setTestNow();

        return $delivery;
    });
}

it('shows a rider what they finished inside the window', function () {
    // The control for every refusal below. Without it, a window bolted shut by a
    // mistaken query would pass every other test in this file by returning
    // nothing at all.
    $tenant = Tenant::factory()->create();
    $rider = riderOf($tenant);

    $delivery = riderCompletedDelivery($tenant, $rider, Date::now()->subHours(2));

    $this->actingAs($rider)
        ->getJson(riderUrl($tenant, '/api/v1/rider/deliveries?status=completed'))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $delivery->id)
        ->assertJsonPath('data.0.status', DeliveryStatus::Delivered->value);
});

it('hides a delivery finished outside the window from the rider\'s completed list', function () {
    /*
     * RULE 1, ON THE LISTING SURFACE. Five days is comfortably past
     * COMPLETED_WINDOW_HOURS and is chosen rather than 73 hours so the test does
     * not fail on a boundary the implementation is entitled to move by an hour.
     * What is being asserted is that a bound EXISTS and is applied, not its exact
     * value — the value is argued in the controller, where it belongs.
     */
    $tenant = Tenant::factory()->create();
    $rider = riderOf($tenant);

    riderCompletedDelivery($tenant, $rider, Date::now()->subDays(5));

    $this->actingAs($rider)
        ->getJson(riderUrl($tenant, '/api/v1/rider/deliveries?status=completed'))
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('refuses a rider a delivery they finished outside the window', function () {
    /*
     * RULE 1, ON THE READ SURFACE — and without this one the listing's bound
     * would be cosmetic. A rider who opened a delivery yesterday holds its
     * identifier, and a `show` with no bound would go on handing back the
     * recipient, the telephone number and the address for as long as the row
     * exists.
     *
     * 404 AND NOT 403, WHICH IS THE ASSERTION THAT MATTERS. Every refusal on this
     * surface answers 404 so that a rider learns nothing from the difference
     * between "not yours" and "does not exist" — and an address that is no longer
     * theirs to read is no longer theirs to be told about either. A 403 here
     * would confirm the delivery is still on file.
     */
    $tenant = Tenant::factory()->create();
    $rider = riderOf($tenant);

    $delivery = riderCompletedDelivery($tenant, $rider, Date::now()->subDays(5));

    $this->actingAs($rider)
        ->getJson(riderUrl($tenant, "/api/v1/rider/deliveries/{$delivery->id}"))
        ->assertNotFound();
});

it('keeps another rider\'s finished work out of a rider\'s completed list', function () {
    /*
     * RULE 2, ON THE LISTING SURFACE. `index()` filters on `rider_id` read from
     * the SESSION, so there is no parameter a client could send that widens this
     * — which is exactly why it is worth asserting: the protection is invisible
     * in the request, and an invisible protection is the kind a refactor removes
     * without anybody noticing the diff.
     *
     * SAME TENANT, TWO RIDERS. Row-level security would hide a delivery belonging
     * to another clinic without the controller doing anything at all, so a
     * cross-tenant fixture here would pass whether or not the ownership filter
     * existed. Two riders of ONE clinic is the case the filter is the only
     * control for.
     */
    $tenant = Tenant::factory()->create();
    $mine = riderOf($tenant);
    $theirs = riderOf($tenant);

    riderCompletedDelivery($tenant, $theirs, Date::now()->subHours(2));

    $this->actingAs($mine)
        ->getJson(riderUrl($tenant, '/api/v1/rider/deliveries?status=completed'))
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('refuses a rider another rider\'s finished delivery', function () {
    /*
     * RULE 2, ON THE READ SURFACE. `DeliveryPolicy::updateStatus()` — which is
     * what `show` authorises against — admits only the ASSIGNED rider of the same
     * tenant, so widening the completed listing did not widen this. Asserted here
     * against a SETTLED delivery specifically: the existing coverage in
     * ApiAuthorisationTest proves the same rule for an active assignment, and the
     * whole risk of this change is that finished work took a different path
     * through the controller.
     */
    $tenant = Tenant::factory()->create();
    $mine = riderOf($tenant);
    $theirs = riderOf($tenant);

    $delivery = riderCompletedDelivery($tenant, $theirs, Date::now()->subHours(2));

    $this->actingAs($mine)
        ->getJson(riderUrl($tenant, "/api/v1/rider/deliveries/{$delivery->id}"))
        ->assertForbidden();
});

it('never ages out work that is still assigned to the rider', function () {
    /*
     * THE WINDOW BOUNDS DISCLOSURE, NOT THE JOB. A delivery still assigned to
     * this rider is visible however long it has been sitting there, because a
     * package that vanished from a rider's round for being old is a package
     * nobody delivers — a worse failure than the one the window prevents, and the
     * failure mode of a bound applied to the wrong branch.
     *
     * BOTH SURFACES AGAIN: it stays on the round AND it stays readable.
     */
    $tenant = Tenant::factory()->create();
    $rider = riderOf($tenant);

    $stale = app(Tenancy::class)->run($tenant->id, function () use ($rider) {
        Date::setTestNow(Date::now()->subDays(30));

        $delivery = Delivery::factory()->create();
        $delivery->assignTo($rider->id);

        Date::setTestNow();

        return $delivery;
    });

    $this->actingAs($rider)
        ->getJson(riderUrl($tenant, '/api/v1/rider/deliveries'))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $stale->id);

    $this->actingAs($rider)
        ->getJson(riderUrl($tenant, "/api/v1/rider/deliveries/{$stale->id}"))
        ->assertOk()
        ->assertJsonPath('data.status', DeliveryStatus::Assigned->value);
});

it('gives finished work no wider a payload than live work', function () {
    /*
     * THE MINIMISATION RULE, RE-ASSERTED ON THE NEW SURFACE. `RiderDeliveryResource`
     * is a separate class with no clinical fields on it — not the dispatcher's
     * with fields hidden, "because a hidden field is one careless template away
     * from being displayed; an absent field cannot be" — and the completed branch
     * renders the same class. This test is what stops a future change from
     * deciding that finished work is safer and giving it `failure_reason`, the
     * dispense order, or the medicines.
     *
     * Deliberately mirrors the assertion in ApiAuthorisationTest rather than
     * inventing a new one: two audiences of the same resource should be held to
     * one standard, written the same way, so a reader can see they are the same
     * standard.
     */
    $tenant = Tenant::factory()->create();
    $rider = riderOf($tenant);

    riderCompletedDelivery($tenant, $rider, Date::now()->subHours(2));

    $response = $this->actingAs($rider)
        ->getJson(riderUrl($tenant, '/api/v1/rider/deliveries?status=completed'))
        ->assertOk();

    $body = strtolower(json_encode($response->json('data')) ?: '');

    foreach ([
        'diagnosis', 'medicine', 'prescription', 'clinical', 'note',
        'dosage', 'directions', 'condition', 'failure_reason', 'dispense_order',
    ] as $term) {
        expect(str_contains($body, $term))->toBeFalse("Rider completed payload leaked '{$term}'");
    }
});
