<?php

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| The closure you provide to your test functions is always bound to a specific PHPUnit test
| case class. By default, that class is "PHPUnit\Framework\TestCase". Of course, you may
| need to change it using the "pest()" function to bind different classes or traits.
|
*/

/*
 * DatabaseTransactions, not RefreshDatabase.
 *
 * RefreshDatabase runs migrations on the DEFAULT connection, which is
 * carevelo_app -- a role that deliberately has no DDL privileges. It cannot
 * create tables, and it must not be able to: the moment the application role
 * can create or own a table, PostgreSQL exempts it from row-level security and
 * every isolation policy silently stops working.
 *
 * So the schema is migrated once, as carevelo_migrator, via `composer test`,
 * and each test runs inside a transaction that is rolled back afterwards.
 *
 * See docs/30-architecture/multi-tenancy.md
 */
pest()->extend(TestCase::class)
    ->use(DatabaseTransactions::class)
    ->in('Feature');

/*
|--------------------------------------------------------------------------
| Expectations
|--------------------------------------------------------------------------
|
| When you're writing tests, you often need to check that values meet certain conditions. The
| "expect()" function gives you access to a set of "expectations" methods that you can use
| to assert different things. Of course, you may extend the Expectation API at any time.
|
*/

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Functions
|--------------------------------------------------------------------------
|
| While Pest is very powerful out-of-the-box, you may have some testing code specific to your
| project that you don't want to repeat in every file. Here you can also expose helpers as
| global functions to help you to reduce the number of lines of code in your test files.
|
*/

/**
 * Project-specific test helpers live here.
 *
 * Tenancy helpers -- asTenant(), withoutTenant() and the cross-tenant isolation
 * assertions -- are added alongside the tenancy foundation.
 */
