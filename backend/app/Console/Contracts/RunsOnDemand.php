<?php

namespace App\Console\Contracts;

/**
 * A command invoked by a person or by CI, never by the scheduler.
 *
 * ScheduledWorkTest asserts that every command is scheduled, because a sweep
 * nobody scheduled does nothing for ever and does it silently — that is how
 * `payments:reconcile` came to exist, be tested, and never once run.
 *
 * Developer tooling is genuinely different: an export command is *supposed* to run
 * only when someone changes the API. But "obviously that one is different" is how
 * an exemption list rots, so the exemption is declared here and has to carry a
 * REASON — the same bargain `Schema::markPlatformScoped()` strikes for a table
 * opting out of the tenant-scoping presumption.
 *
 * Implementing this is a visible act in the diff that introduces the command. It
 * is not a way to silence the guard; it is a way to answer it.
 */
interface RunsOnDemand
{
    /**
     * Why this command is not on the schedule.
     *
     * Must be a real sentence. The test rejects an empty one.
     */
    public function whyNotScheduled(): string;
}
