# Running Carevelo in Docker

## Once, first

```bash
cd frontend && pnpm install
cd ../backend && composer install
```

The containers run against these. They install nothing of their own — see below.

## Then

```bash
docker compose up
```

That is the whole command. First run pulls two base images, creates the two
database roles, migrates and seeds. It downloads no packages.

Then:

| Surface | URL |
|---|---|
| Patient portal | http://kira.localhost:3000 |
| Clinic console | http://kira.localhost:3001 |
| Rider view | http://kira.localhost:3002 |
| Platform admin | http://kira.localhost:3003 |
| API | http://localhost:8000 |

Sign in with `demo-password`: patient `aisha-nambooze@kira.test`,
staff `sarah-nakato@kira.test`.

## Use `kira.localhost`, not `localhost`

Tenancy is resolved from the **Host header**. A request to `localhost` resolves
to no clinic and renders the 404 page — which on a first run looks exactly like
a broken install. Most browsers resolve `*.localhost` to 127.0.0.1 with no
configuration. If yours does not, add:

```
127.0.0.1  kira.localhost
```

## The two database roles are the isolation control

PostgreSQL **exempts a table's owner from row-level security**. So the schema is
owned by `carevelo_migrator`, and the application connects as `carevelo_app`,
which owns nothing and holds `NOBYPASSRLS`.

Collapsing them into one role leaves the database working perfectly and every
tenant-isolation policy **silently inert**. Nothing goes red. That is why the
`setup` service runs `php artisan db:roles` — one implementation of the rule,
shared with local development, so the two cannot drift.

To satisfy yourself it held:

```bash
docker compose exec postgres psql -U postgres -d carevelo \
  -c "select rolname, rolbypassrls from pg_roles where rolname like 'carevelo%';"
```

`carevelo_app` must show `rolbypassrls = f`.

## What is running

Beyond the obvious: a **queue worker** and a **scheduler**. They are not
optional. Payment reconciliation is scheduled every minute and subscription
lapse-suspension is scheduled; a stack with the API up and neither running looks
completely healthy and quietly does nothing.

## Video is the dev LiveKit, and it proves less than it looks

The `livekit` service runs `--dev`: one container, no TLS, **no TURN**. It is
enough to watch two browsers on this machine join a room. It proves nothing
about a real call. Ugandan mobile carriers sit behind carrier-grade NAT, so
without TURN the clinician connects and the patient does not — silently, and
differently per carrier and handset.

`deploy/livekit/` is the real deployment, with coturn. Read its README before
putting video in front of anyone.

## This is a development stack

`next dev` and `artisan serve`, source mounted, secrets from `.env.example` and
therefore public. The foot of `docker-compose.yml` lists what a production one
needs instead.

## The images install nothing, and that is deliberate

They mount the host's `frontend/node_modules` and `backend/vendor` rather than
installing their own. An earlier version installed inside the image and, on a
slow connection, never finished: 377 packages at 9–42 KiB/s, dying on
`TimeoutError` after five minutes.

It could not simply reuse the host's because the images were **alpine** (musl)
and this host is **glibc** — native builds are not interchangeable, so the
container had to fetch musl equivalents of `@next/swc`, `lightningcss`,
`@rolldown/binding` and `@swc/core`. The images are now `node:22` and
`php:8.3-cli`, both glibc, so the mount just works.

PHP **extensions** are still compiled into the API image, and must be: they are
runtime extensions rather than Composer packages, so no mount can supply them.
That is one `docker-php-ext-install`, not 377 tarballs.

**The trade:** these images are not self-contained. They are a development
stack. A production image installs its own dependencies — the foot of
`docker-compose.yml` lists what else it would need.
