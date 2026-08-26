<?php

use App\Models\Appointment;
use App\Models\ClinicalRole;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\PaymentMethod;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Carbon\CarbonImmutable;
use Database\Factories\AggregatorAccountFactory;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| GET /v1/revenue -- the figure, and what it is not
|--------------------------------------------------------------------------
|
| The clinic console carried a placeholder where this screen belongs, and its
| argument was correct at the time: the only figures the platform held were
| counts of ATTEMPTS, and summing those would have asserted that every attempt
| reported as succeeded reached the clinic's account. Pesapal's
| GetTransactionStatus supplies the missing observation -- a COMPLETED with a
| confirmation code, refused unless the amount agrees with what we asked to be
| collected -- so there is now a real thing to report.
|
| What did not change is custody. Money never passes through Carevelo, no
| account exists here for it to pass through, and nobody here can see the
| clinic's bank account. These tests hold the line in both directions: the
| figure must be RIGHT, and it must never be LABELLED as money that arrived.
|
| See docs/70-decisions/0003-non-custodial-payment-architecture.md
| and docs/30-architecture/frontend-nextjs.md acceptance criterion 9.
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function revenueUrl(Tenant $tenant, string $query = ''): string
{
    return sprintf(
        'http://%s.%s/api/v1/revenue%s',
        $tenant->subdomain,
        parse_url((string) config('app.url'), PHP_URL_HOST),
        $query,
    );
}

/** The whole of August, in whichever timezone the clinic keeps. */
function revenueAugust(): string
{
    return '?from=2026-08-01&to=2026-08-31';
}

/**
 * A clinic whose own aggregator account is LIVE.
 *
 * Live, not the factory's default sandbox, because a sandbox account is how
 * this endpoint recognises test data -- so a fixture that forgot to go live
 * would make every assertion below pass by returning zero, which is the most
 * dangerous kind of green.
 */
function revenueClinic(string $timezone = 'Africa/Kampala'): Tenant
{
    $tenant = Tenant::factory()->create(['timezone' => $timezone]);

    app(Tenancy::class)->run($tenant->id, fn () => AggregatorAccountFactory::new()->createOne([
        'provider' => 'flutterwave',
        'environment' => 'live',
    ]));

    return $tenant;
}

function revenueStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role): User {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * One payment attempt, in the clinic's context.
 *
 * `resolved_at` is set explicitly rather than through markSucceeded(), because
 * every interesting question here is about WHICH INSTANT a confirmation landed
 * on and a helper that stamps `now()` cannot ask it.
 *
 * @param  array<string, mixed>  $attributes
 */
function revenueIntent(Tenant $tenant, array $attributes): PaymentIntent
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn (): PaymentIntent => PaymentIntent::factory()->create($attributes),
    );
}

function revenueService(Tenant $tenant, string $name): Service
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn (): Service => Service::factory()->create(['name' => $name]),
    );
}

/** A confirmed collection for a named service, at a named instant. */
function revenueConfirmed(
    Tenant $tenant,
    Service $service,
    int $amountMinor,
    string $confirmedAt,
    PaymentMethod $method = PaymentMethod::MtnMomo,
): PaymentIntent {
    $appointment = app(Tenancy::class)->run(
        $tenant->id,
        fn (): Appointment => Appointment::factory()->create(['service_id' => $service->id]),
    );

    return revenueIntent($tenant, [
        'payable_type' => 'appointment',
        'payable_id' => $appointment->id,
        'amount_minor' => $amountMinor,
        'method' => $method,
        'status' => PaymentIntentStatus::Succeeded,
        'resolved_at' => CarbonImmutable::parse($confirmedAt, $tenant->timezone),
    ]);
}

/**
 * One row of a breakdown, found by a field value.
 *
 * Returned whole rather than asserted with assertJsonFragment, which matches
 * each key INDEPENDENTLY: a fragment naming a service id and a count would be
 * satisfied by the id appearing in one row and the count in another, which is
 * exactly the mix-up a grouped response can produce and exactly what these
 * tests are for.
 *
 * @return array<mixed, mixed>
 */
function revenueRow(mixed $rows, string $field, string $value): array
{
    foreach (is_array($rows) ? $rows : [] as $row) {
        if (is_array($row) && ($row[$field] ?? null) === $value) {
            return $row;
        }
    }

    throw new RuntimeException("No breakdown row where {$field} is '{$value}'.");
}

/** The minor-unit total on one breakdown row. */
function revenueMinor(mixed $row): mixed
{
    $money = is_array($row) ? ($row['aggregator_confirmed_total'] ?? null) : null;

    return is_array($money) ? ($money['amount_minor'] ?? null) : null;
}

/**
 * Every minor-unit total in a breakdown.
 *
 * A row whose total cannot be read as an integer contributes -1 rather than
 * being skipped, so a sum built from unreadable rows fails loudly instead of
 * quietly agreeing with a headline it never covered.
 *
 * @return list<int>
 */
function revenueMinorUnits(mixed $rows): array
{
    $totals = [];

    foreach (is_array($rows) ? $rows : [] as $row) {
        $amount = revenueMinor($row);

        $totals[] = is_int($amount) ? $amount : -1;
    }

    return $totals;
}

/**
 * What each row of the by-service breakdown is a group OF.
 *
 * The service name where there is one, and the payable type where there is
 * not -- a dispensing order has no bookable service. Both are legitimate
 * groups and both must survive being paged through, which is the whole point
 * of the group key never being null.
 *
 * @return list<string>
 */
function revenueGroupLabels(mixed $rows): array
{
    $labels = [];

    foreach (is_array($rows) ? $rows : [] as $row) {
        $name = is_array($row) ? ($row['service_name'] ?? null) : null;
        $paidFor = is_array($row) ? ($row['paid_for'] ?? null) : null;

        $labels[] = match (true) {
            is_string($name) => $name,
            is_string($paidFor) => $paidFor,
            default => '-',
        };
    }

    return $labels;
}

it('counts only what the aggregator confirmed, and never an attempt', function () {
    // THE criterion: "The revenue view excludes test data and never counts
    // pending payments as earned."
    //
    // Every excluded status is present at once rather than one per test,
    // because the failure that matters is a filter that lets ONE of them
    // through -- and a suite that checks them separately can be green while the
    // clinic's screen is wrong by exactly one row.
    $tenant = revenueClinic();
    $service = revenueService($tenant, 'General Consultation');
    $confirmedAt = '2026-08-10 10:00:00';

    revenueConfirmed($tenant, $service, 3_000_000, $confirmedAt);

    foreach ([
        PaymentIntentStatus::Initiated,
        PaymentIntentStatus::Pending,
        PaymentIntentStatus::Failed,
        PaymentIntentStatus::TimedOut,
        PaymentIntentStatus::Reversed,
    ] as $status) {
        revenueIntent($tenant, [
            'amount_minor' => 99_000_000,
            'status' => $status,
            'resolved_at' => CarbonImmutable::parse($confirmedAt, $tenant->timezone),
        ]);
    }

    // Cash the clinic really did receive. It is still not an aggregator
    // confirmation, and this endpoint's heading says confirmation.
    //
    // TWO ROWS, and the second is the one that tests anything. A cash intent as
    // the API creates it names no aggregator, so it is already excluded by the
    // live-account check and a suite holding only that row stays green after
    // the cash filter is deleted -- which is how a guard that looks redundant
    // gets removed by someone tidying up. The second row is a cash attestation
    // carrying an aggregator name: the inconsistent state the filter actually
    // exists for -- a method corrected after the fact, a data migration, a
    // future flow that stamps the provider before the method is known. A staff
    // attestation is the clinic's own internal control and never an
    // aggregator's confirmation, whatever else is on the row.
    foreach ([null, 'flutterwave'] as $aggregator) {
        revenueIntent($tenant, [
            'amount_minor' => 99_000_000,
            'method' => PaymentMethod::CashAtClinic,
            'aggregator' => $aggregator,
            'status' => PaymentIntentStatus::Succeeded,
            'resolved_at' => CarbonImmutable::parse($confirmedAt, $tenant->timezone),
        ]);
    }

    $this->actingAs(revenueStaff($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($tenant, revenueAugust()))
        ->assertOk()
        ->assertJsonPath('data.aggregator_confirmed_count', 1)
        ->assertJsonPath('data.aggregator_confirmed_total.amount_minor', 3_000_000)
        ->assertJsonPath('data.aggregator_confirmed_total.currency', 'UGX');
});

it('excludes collections taken against an account that is not live', function () {
    // Test data, and the only signal the platform has for it: a clinic
    // rehearsing onboarding runs its OWN merchant account in the aggregator's
    // sandbox, where a COMPLETED is a rehearsal with a real-looking
    // confirmation code and no shilling moved.
    $tenant = Tenant::factory()->create(['timezone' => 'Africa/Kampala']);

    app(Tenancy::class)->run($tenant->id, fn () => AggregatorAccountFactory::new()->createOne([
        'provider' => 'flutterwave',
        'environment' => 'sandbox',
    ]));

    revenueConfirmed($tenant, revenueService($tenant, 'General Consultation'), 3_000_000, '2026-08-10 10:00:00');

    $this->actingAs(revenueStaff($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($tenant, revenueAugust()))
        ->assertOk()
        ->assertJsonPath('data.aggregator_confirmed_count', 0)
        ->assertJsonPath('data.aggregator_confirmed_total.amount_minor', 0)
        ->assertJsonPath('data.by_service', []);
});

it('resolves the window in the clinic\'s timezone, not the server\'s', function () {
    // THE day-boundary test, and it fails in BOTH directions if the window is
    // resolved in UTC:
    //
    //   01:00 on 1 August in Kampala is 22:00 on 31 July UTC -- a UTC window
    //   would drop a payment the clinic took on the first of the month.
    //
    //   01:00 on 1 September in Kampala is 22:00 on 31 August UTC -- a UTC
    //   window would pull next month's payment into this one.
    //
    // Three hours at each end of every month, in opposite directions, which is
    // discovered when a clinic's own totals disagree with ours and nobody can
    // say why.
    $tenant = revenueClinic('Africa/Kampala');
    $service = revenueService($tenant, 'General Consultation');

    revenueConfirmed($tenant, $service, 1_100_000, '2026-08-01 01:00:00');
    revenueConfirmed($tenant, $service, 2_200_000, '2026-08-31 23:30:00');
    revenueConfirmed($tenant, $service, 9_900_000, '2026-07-31 23:00:00');
    revenueConfirmed($tenant, $service, 8_800_000, '2026-09-01 01:00:00');

    $this->actingAs(revenueStaff($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($tenant, revenueAugust()))
        ->assertOk()
        ->assertJsonPath('data.aggregator_confirmed_count', 2)
        ->assertJsonPath('data.aggregator_confirmed_total.amount_minor', 3_300_000)
        ->assertJsonPath('data.clinic_timezone', 'Africa/Kampala')
        ->assertJsonPath('data.confirmed_from', '2026-08-01')
        ->assertJsonPath('data.confirmed_to', '2026-08-31');
});

it('reads the day from the tenant record and never from the caller', function () {
    // The same instant, judged by two clinics in different timezones. A caller
    // who could choose the timezone could choose which day a payment falls in,
    // and therefore which month's figure it lands in -- so the timezone comes
    // off the tenant row bound by ResolveTenant and from nowhere else.
    $kampala = revenueClinic('Africa/Kampala');
    $lagos = revenueClinic('Africa/Lagos');

    // 23:30 on 31 August in Lagos (+01:00) is 01:30 on 1 September in Kampala.
    $instant = CarbonImmutable::parse('2026-08-31 23:30:00', 'Africa/Lagos');

    foreach ([$kampala, $lagos] as $tenant) {
        $appointment = app(Tenancy::class)->run(
            $tenant->id,
            fn (): Appointment => Appointment::factory()->create([
                'service_id' => revenueService($tenant, 'General Consultation')->id,
            ]),
        );

        revenueIntent($tenant, [
            'payable_type' => 'appointment',
            'payable_id' => $appointment->id,
            'amount_minor' => 5_000_000,
            'status' => PaymentIntentStatus::Succeeded,
            'resolved_at' => $instant,
        ]);
    }

    $this->actingAs(revenueStaff($lagos, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($lagos, revenueAugust()))
        ->assertOk()
        ->assertJsonPath('data.aggregator_confirmed_count', 1);

    $this->actingAs(revenueStaff($kampala, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($kampala, revenueAugust()))
        ->assertOk()
        ->assertJsonPath('data.aggregator_confirmed_count', 0);
});

it('groups by service and by the method the collection was opened with', function () {
    $tenant = revenueClinic();
    $consultation = revenueService($tenant, 'General Consultation');
    $antenatal = revenueService($tenant, 'Antenatal Review');

    revenueConfirmed($tenant, $consultation, 3_000_000, '2026-08-02 09:00:00', PaymentMethod::MtnMomo);
    revenueConfirmed($tenant, $consultation, 3_000_000, '2026-08-03 09:00:00', PaymentMethod::AirtelMoney);
    revenueConfirmed($tenant, $antenatal, 5_000_000, '2026-08-04 09:00:00', PaymentMethod::MtnMomo);

    // A dispensing order. It has no bookable service, so it groups on its own
    // rather than being folded into one it did not belong to.
    revenueIntent($tenant, [
        'payable_type' => 'dispense_order',
        'amount_minor' => 1_500_000,
        'method' => PaymentMethod::Card,
        'status' => PaymentIntentStatus::Succeeded,
        'resolved_at' => CarbonImmutable::parse('2026-08-05 09:00:00', $tenant->timezone),
    ]);

    $body = $this->actingAs(revenueStaff($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($tenant, revenueAugust()))
        ->assertOk();

    $byService = $body->json('data.by_service');
    $byMethod = $body->json('data.by_method_recorded');

    $consultationRow = revenueRow($byService, 'service_name', 'General Consultation');

    expect($consultationRow['aggregator_confirmed_count'])->toBe(2)
        ->and(revenueMinor($consultationRow))->toBe(6_000_000)
        ->and($consultationRow['service_id'])->toBe($consultation->id)
        ->and($consultationRow['paid_for'])->toBe('appointment');

    expect(revenueMinor(revenueRow($byService, 'service_name', 'Antenatal Review')))->toBe(5_000_000)
        ->and(revenueRow($byService, 'service_name', 'Antenatal Review')['service_id'])->toBe($antenatal->id);

    $dispensing = revenueRow($byService, 'paid_for', 'dispense_order');

    // Null, not a made-up service. A dispensing order has none, and inventing a
    // heading for it would put medicines under a bookable service that does not
    // exist.
    expect($dispensing['service_id'])->toBeNull()
        ->and($dispensing['service_name'])->toBeNull()
        ->and(revenueMinor($dispensing))->toBe(1_500_000);

    expect(revenueMinor(revenueRow($byMethod, 'method_recorded', 'mtn_momo')))->toBe(8_000_000)
        ->and(revenueMinor(revenueRow($byMethod, 'method_recorded', 'airtel_money')))->toBe(3_000_000)
        ->and(revenueMinor(revenueRow($byMethod, 'method_recorded', 'card')))->toBe(1_500_000);

    // The breakdowns account for the whole figure. A screen whose parts do not
    // sum to its headline is worse than one with no headline at all: it is
    // visible and unexplainable at the same time.
    $body->assertJsonPath('data.aggregator_confirmed_total.amount_minor', array_sum(revenueMinorUnits($byService)))
        ->assertJsonPath('data.aggregator_confirmed_total.amount_minor', array_sum(revenueMinorUnits($byMethod)))
        ->assertJsonPath('data.aggregator_confirmed_total.amount_minor', 12_500_000);
});

it('sums exactly in minor units, with no float anywhere in the path', function () {
    // The amounts are absurd for a clinic; the arithmetic is the subject. Their
    // sum is 2^53 + 1, the first integer an IEEE-754 double cannot hold -- so a
    // total that passed through a float at ANY point (a PostgreSQL numeric read
    // through a PHP float, a JSON number decoded loosely, a client adding the
    // breakdown up in a browser) comes back one unit short and looks perfectly
    // reasonable.
    $tenant = revenueClinic();
    $service = revenueService($tenant, 'General Consultation');

    revenueConfirmed($tenant, $service, 9_007_199_254_740_992, '2026-08-02 09:00:00');
    revenueConfirmed($tenant, $service, 1, '2026-08-03 09:00:00');

    $body = $this->actingAs(revenueStaff($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($tenant, revenueAugust()))
        ->assertOk()
        // assertJsonPath compares with assertSame, so a total rendered as a
        // string or a float fails here rather than reading as equal.
        ->assertJsonPath('data.aggregator_confirmed_total.amount_minor', 9_007_199_254_740_993);

    expect(revenueMinor(revenueRow($body->json('data.by_service'), 'service_name', 'General Consultation')))
        ->toBe(9_007_199_254_740_993)
        ->toBeInt();
});

it('pages the service breakdown by cursor and refuses an offset', function () {
    // Cursor, never offset. A clinic's service list is edited while an
    // administrator reads this screen and a late confirmation can add a group
    // between two requests -- an offset would then repeat one service and skip
    // another, giving a breakdown whose rows are each correct and whose sum is
    // wrong.
    $tenant = revenueClinic();

    foreach (['Alpha Clinic Visit', 'Beta Review', 'Gamma Screening'] as $index => $name) {
        revenueConfirmed(
            $tenant,
            revenueService($tenant, $name),
            1_000_000 * ($index + 1),
            sprintf('2026-08-%02d 09:00:00', $index + 2),
        );
    }

    // A FOURTH group with no service at all, and it is here to be paged
    // through rather than for its total.
    //
    // A dispensing order keys on its payable type instead of a service id, and
    // that key exists precisely so it is never null. A nullable cursor column
    // silently breaks keyset pagination -- `group_key > :cursor` is neither
    // true nor false against NULL, so the row is skipped in both directions and
    // an entire group of confirmed payments disappears somewhere after the
    // first page, with every visible number still adding up. Without this row
    // the cursor could be keyed on the nullable service id and nothing here
    // would notice.
    revenueIntent($tenant, [
        'payable_type' => 'dispense_order',
        'amount_minor' => 4_000_000,
        'method' => PaymentMethod::Card,
        'status' => PaymentIntentStatus::Succeeded,
        'resolved_at' => CarbonImmutable::parse('2026-08-06 09:00:00', $tenant->timezone),
    ]);

    $first = $this->actingAs(revenueStaff($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($tenant, revenueAugust().'&per_page=2'))
        ->assertOk()
        ->assertJsonCount(2, 'data.by_service')
        // The headline covers the WINDOW, not the page. A total that shrank as
        // the reader paged would be read as money disappearing.
        ->assertJsonPath('data.aggregator_confirmed_count', 4)
        ->assertJsonPath('data.aggregator_confirmed_total.amount_minor', 10_000_000);

    $cursor = $first->json('meta.by_service_next_cursor');

    expect($cursor)->toBeString();

    $second = $this->actingAs(revenueStaff($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($tenant, revenueAugust().'&per_page=2&cursor='.urlencode(is_string($cursor) ? $cursor : '')))
        ->assertOk()
        ->assertJsonCount(2, 'data.by_service')
        ->assertJsonPath('meta.by_service_next_cursor', null)
        ->assertJsonPath('data.aggregator_confirmed_total.amount_minor', 10_000_000);

    // Every group arrives exactly once across the two pages -- the three
    // services and the one that has none.
    $labels = array_merge(
        revenueGroupLabels($first->json('data.by_service')),
        revenueGroupLabels($second->json('data.by_service')),
    );

    expect($labels)->toEqualCanonicalizing(
        ['Alpha Clinic Visit', 'Beta Review', 'Gamma Screening', 'dispense_order']
    );

    // There is no offset to ask for, and asking is an error rather than a
    // silently discarded parameter that leaves the caller on page one forever
    // believing they have walked the whole breakdown.
    $this->actingAs(revenueStaff($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($tenant, revenueAugust().'&page=2'))
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');
});

it('refuses the takings view to anyone but the administrator', function () {
    // Denial tested, not just permission, and on the same ability the
    // reconciliation view uses. A clinic's whole takings are a commercial view
    // of the business: a pharmacist and a front-desk clerk both take payments
    // and neither has business in this.
    $tenant = revenueClinic();

    foreach ([ClinicalRole::Pharmacist, ClinicalRole::FrontDesk, ClinicalRole::Clinician] as $role) {
        $this->actingAs(revenueStaff($tenant, $role))
            ->getJson(revenueUrl($tenant))
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
    }
});

it('never lets one clinic\'s confirmations reach another clinic\'s figures', function () {
    // Row-level security, asserted at this endpoint rather than assumed from
    // the layer below: the by-service breakdown joins appointments and services
    // by hand, and a join is exactly where a scoped read stops being scoped if
    // the isolation were an Eloquent convenience rather than a database policy.
    $clinicA = revenueClinic();
    $clinicB = revenueClinic();

    revenueConfirmed($clinicA, revenueService($clinicA, 'General Consultation'), 7_000_000, '2026-08-10 10:00:00');

    $this->actingAs(revenueStaff($clinicB, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($clinicB, revenueAugust()))
        ->assertOk()
        ->assertJsonPath('data.aggregator_confirmed_count', 0)
        ->assertJsonPath('data.aggregator_confirmed_total.amount_minor', 0)
        ->assertJsonPath('data.by_service', []);
});

it('answers a neutral 404 on a host that is not a clinic, never a 403', function () {
    // A 403 would confirm the endpoint is there to be refused, which turns a
    // loop over subdomains into a customer list -- and that a person is a
    // patient of a named clinic is itself health-adjacent information.
    //
    // There is no path segment or query parameter on this route naming a
    // tenant, by design, so an unresolvable host is the only way to ask across
    // the boundary at all. It is answered exactly as a closed clinic is.
    $tenant = revenueClinic();

    $this->actingAs(revenueStaff($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(sprintf(
            'http://not-a-clinic.%s/api/v1/revenue',
            parse_url((string) config('app.url'), PHP_URL_HOST),
        ))
        ->assertNotFound();
});

it('makes no claim that the money reached the clinic', function () {
    // THE naming test, and the reason this endpoint was allowed to exist at
    // all. RevenuePlaceholder's argument was that a plausible, precise,
    // confidently-rendered number nobody could stand behind is worse than no
    // number -- and that a clinic owner would make decisions on it. What makes
    // this response standable-behind is that every figure says WHOSE
    // observation it is and WHAT was observed.
    $tenant = revenueClinic();

    revenueConfirmed($tenant, revenueService($tenant, 'General Consultation'), 3_000_000, '2026-08-10 10:00:00');

    $response = $this->actingAs(revenueStaff($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(revenueUrl($tenant, revenueAugust()))
        ->assertOk();

    $json = strtolower((string) json_encode($response->json()));

    // Custody vocabulary. Its absence is a compliance control, not a naming
    // preference -- see ForbiddenIdentifiersTest and ADR-0003.
    foreach (['wallet', 'balance', 'escrow', 'payout', 'settlement'] as $forbidden) {
        expect($json)->not->toContain($forbidden, "The takings view leaked '{$forbidden}'");
    }

    // Words that would assert the money arrived. "Received" and "earned" are
    // the two the placeholder and the acceptance criterion name outright.
    foreach (['received', 'earned', 'revenue', 'deposited', 'cleared'] as $overclaim) {
        expect($json)->not->toContain($overclaim, "The takings view claimed '{$overclaim}'");
    }

    // And every figure carries the qualifier that makes it true. `_confirmed_`
    // names the observer and the verb in one breath, so no key can be read off
    // in isolation and taken for a bank figure.
    $response->assertJsonStructure([
        'data' => [
            'confirmed_from',
            'confirmed_to',
            'clinic_timezone',
            'aggregator_confirmed_count',
            'aggregator_confirmed_total' => ['amount_minor', 'currency'],
            'by_method_recorded',
            'by_service',
        ],
        'meta' => ['counts', 'does_not_count', 'not_money_in_the_bank', 'by_service_next_cursor'],
    ]);

    expect($response->json('meta.not_money_in_the_bank'))->toContain('never passes through Carevelo');
    expect($response->json('meta.does_not_count'))->toBeArray();
    expect($response->json('meta.does_not_count'))->not->toBeEmpty();
});
