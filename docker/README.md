# Running Carevelo in Docker

```bash
docker compose up
```

That is the whole command. First run takes a few minutes: it installs PHP and
Node dependencies, creates the two database roles, migrates and seeds.

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

## If the build is slow or times out

The first build downloads a lot. On a thin connection the original version of
these files failed after six minutes of retries, and three things now stop that
being fatal:

- **Two images, not nine.** Every service sharing a Dockerfile also shares an
  `image:` name. Compose keys a build by that name, so without it the five PHP
  services and four Node services built *separately* — nine full dependency
  installs racing each other for one connection.
- **Cache mounts.** A failed build no longer throws away what it downloaded, so
  a retry resumes instead of restarting. If a build dies, just run it again.
- **Four parallel downloads, not sixteen.** pnpm's default saturates a thin link
  so completely that every stream drops under the 50 KiB/s floor it warns about.
  Fewer streams finish sooner.

Playwright's browsers (~150 MB) are skipped: the container runs `next dev` and
never opens one. Browser tests run on your machine against a stack that is up.

Still struggling? Build one image at a time so a failure costs less:

```bash
docker compose build patient-portal   # the web image, shared by all four apps
docker compose build api              # the PHP image, shared by five services
docker compose up
```
