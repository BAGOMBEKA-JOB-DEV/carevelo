# Consultation media — self-hosted LiveKit

This directory is the media server Carevelo's teleconsultations run on. It is a
LiveKit SFU, a TURN relay and a reverse proxy on one VPS that we operate.

[ADR-0004](../../docs/70-decisions/0004-video-provider-selection.md) chose this
over a managed provider on cost: a Starter clinic pays UGX 150,000/month (~$40)
with teleconsult included, and a per-minute provider takes $4 (LiveKit Cloud),
$32 (Daily) or $120 (Twilio) of it at 200 consultations a month. Self-hosted,
the marginal consultation costs nothing.

**It is not free.** It is a fixed bill and a set of chores instead of a variable
bill, and this file is where the chores are written down. Read
[What this actually costs](#what-this-actually-costs) before you decide this was
a good trade — the ADR argued against it, was overruled on cost, and recorded
what was accepted in exchange.

---

## On your own machine

One container, no TLS, no relay, no domain:

```bash
cd deploy/livekit
docker compose -f docker-compose.dev.yml up
```

`backend/.env.example` already points at it:

```
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret-devsecret-devsecret-32
LIVEKIT_URL=ws://127.0.0.1:7880
```

That pair is public, is in this repository, and is worthless — it signs tokens
for a server listening on your laptop. If you are not working on video, comment
those three lines out of your `.env`: with no credentials the API binds
`UnconfiguredVideoProvider`, the redeem endpoint answers `configured: "false"`,
and the patient app shows the clinic's phone number. That is a working state,
not a broken one.

**The dev setup proves nothing about whether video works.** Both browsers and
the SFU are on one machine, so ICE finds a loopback path every time and TURN is
never exercised. The failure this whole directory exists to prevent cannot
happen locally. See [What breaks without TURN](#what-breaks-without-turn).

---

## Production, start to finish

You need a VPS with a public IPv4 address, a domain you control, and about an
hour.

### 1. Pick a host and a region

See [What size VPS](#what-size-vps). Region matters more than specification, and
**it is the open question in ADR-0004**: nobody has measured round-trip time and
loss from Ugandan mobile carriers to any candidate region. Intuition says
Johannesburg or Nairobi; Uganda's international transit runs east to the Mombasa
landing stations and on to Europe, so a Frankfurt or London box can measure
*better* than Johannesburg for some Ugandan ISPs. Measure before you commit —
this is the ADR's named blocker, and self-hosting makes it more important, not
less, because the tuning is now ours.

### 2. Point DNS at it

One `A` record. One hostname does everything: signalling, TURN realm, and the
name on the certificate.

```
media.yourclinic.ug.  A  203.0.113.10
```

### 3. Fill in the two config files

```bash
cd deploy/livekit
cp .env.example .env
cp livekit.yaml.example livekit.yaml

docker run --rm livekit/livekit-server generate-keys   # API key + secret
openssl rand -hex 24                                    # TURN password
```

- `.env` — `MEDIA_DOMAIN`, `ACME_EMAIL`, `MEDIA_PUBLIC_IP`, `TURN_PASSWORD`.
- `livekit.yaml` — the key pair under `keys:`, and under `rtc.turn_servers` the
  same `MEDIA_DOMAIN` as `host` and the same `TURN_PASSWORD` as `credential`.

The TURN password appears in both files and **must match**. A mismatch is silent:
the SFU hands browsers a relay credential the relay rejects, and the only symptom
is that patients on mobile data cannot connect while everyone on wifi can.

Both real files are gitignored. They carry the API secret and the TURN password.

### 4. Open the firewall

Host networking means these processes bind real ports on a real interface, so
this list is the security boundary rather than a convenience.

| Port | Protocol | Who connects | Why |
|---|---|---|---|
| 80 | TCP | Let's Encrypt | ACME challenge, and the redirect to 443 |
| 443 | TCP | every participant | `wss://` signalling, proxied to 7880 |
| 7881 | TCP | some participants | WebRTC media over TCP, for networks that drop UDP |
| 7882 | UDP | most participants | WebRTC media. The normal path |
| 3478 | UDP | CGNAT participants | TURN. The path that makes mobile data work |
| 3478 | TCP | CGNAT participants | TURN where UDP is blocked |
| 5349 | TCP | CGNAT participants | TURN over TLS, for networks that inspect traffic |
| 49160–49300 | UDP | CGNAT participants | coturn's relay allocations. **One port per relayed participant — if this range is closed, TURN accepts the allocation and then relays nothing** |

`7880/tcp` must **not** be open. It is the SFU's signalling and server API, and
Caddy reaches it over loopback. Exposing it publishes an unencrypted endpoint
that browsers cannot use anyway.

```bash
ufw allow 80/tcp && ufw allow 443/tcp
ufw allow 7881/tcp && ufw allow 7882/udp
ufw allow 3478/udp && ufw allow 3478/tcp && ufw allow 5349/tcp
ufw allow 49160:49300/udp
ufw deny 7880/tcp
```

Cloud providers have a second firewall in their console. Both have to agree, and
forgetting the second one produces exactly the symptoms in
[What breaks without TURN](#what-breaks-without-turn).

### 5. Start it

```bash
docker compose up -d
docker compose logs -f caddy      # watch the certificate arrive
```

### 6. Point the API at it

In the Carevelo API's environment (`backend/.env`), not this directory's:

```
LIVEKIT_API_KEY=<the generated key>
LIVEKIT_API_SECRET=<the generated secret>
LIVEKIT_URL=wss://media.yourclinic.ug
```

All three, or none. `AppServiceProvider` treats a partial configuration as
unconfigured on purpose: a URL with no secret cannot mint a token and a secret
with no URL has nowhere to send one, and "configured, and every call fails" is
an honest failure wearing a broken one's clothes.

### 7. Verify it with two devices on mobile data

Not two browser tabs. Not two laptops on the clinic's wifi. **Two phones on two
different mobile carriers, with wifi switched off**, because that is the only
configuration that exercises the relay, and the relay is the part that breaks.

---

## About the certificate

- **Publicly trusted, for `MEDIA_DOMAIN`.** Caddy gets it from Let's Encrypt on
  first start. Self-signed does not work anywhere: browsers validate a `turns:`
  URI against the hostname exactly as they validate `https:`, and they will not
  show a patient an exception dialogue for a relay.
- **One certificate, two users.** coturn mounts Caddy's store read-only and
  reads the same files. That is why the TURN realm and the signalling endpoint
  are the same hostname.
- **What the TLS is for, and what it is not.** WebRTC media is already encrypted
  end to end with DTLS-SRTP on every path, relayed or not. This certificate adds
  no confidentiality to a consultation. It exists so that a relay on port 5349
  looks like ordinary TLS to a middlebox that would otherwise drop it.
- **coturn does not reload certificates.** Caddy renews at 60 days and coturn
  keeps serving the old one until it is restarted. Put this in root's crontab
  and then go and check, once, that it worked:

  ```cron
  0 4 1 * * cd /opt/carevelo/deploy/livekit && docker compose restart coturn
  ```

  An expired certificate on the relay is not a total outage. It breaks TLS relay
  only — so it presents as some patients failing on some networks, which is the
  worst-shaped failure in this document.

---

## What breaks without TURN

TURN is not a fallback. On this network it is the main path for a large share of
patients, and the reason is not tuning:

**Ugandan mobile carriers use carrier-grade NAT.** MTN and Airtel subscribers do
not get a public address; hundreds of handsets share one, behind a NAT that maps
each outbound flow to a fresh port. Nothing outside can address that handset, and
the hole-punching that works behind an ordinary home router does not work
through it, because the carrier's mapping is different for every destination.

For such a patient there is no direct path to the SFU. Their media has to be
relayed by a server both ends *can* reach. That is what TURN is. Without it:

- **The clinician connects and the patient does not.** The clinic is on wifi
  behind an ordinary router, which hole-punches fine. The patient is on mobile
  data. One tile appears; the other never does.
- **It depends on the carrier, the handset and the day.** Some CGNAT
  implementations are more forgiving; some patients are on wifi. So it works
  perhaps half the time, which reads as flakiness rather than as a missing
  component.
- **Nothing logs an error.** ICE does not fail loudly. It gathers candidates,
  tries them, times out after 10–30 seconds, and the call sits on "connecting"
  and then stops. The SFU logs a participant who joined and left. The API logs a
  join token issued and redeemed — because it was; the failure is entirely
  downstream of anything Carevelo records.
- **The reports arrive as "the video doesn't work sometimes."** Which is
  unactionable, arrives weeks later, and by then the clinic has stopped offering
  teleconsultation and gone back to the phone.

The TCP fallback on 7881 is not a substitute. It helps a client that can *reach*
us but cannot use UDP. It does nothing for a client we cannot reach at all.

If you take one thing from this file: **a deployment without a working relay
looks fine in every test you are likely to run, and fails for a large fraction of
the actual patients.**

### Checking that the relay is really working

```bash
docker compose logs coturn | grep -i allocat
```

Real allocations appear here during a real consultation from a real phone on
mobile data. If you have never seen one, you have never tested the path that
matters. Browser-side, `chrome://webrtc-internals` shows the selected candidate
pair: `relay` on one side is the relay doing its job.

---

## What size VPS

Arithmetic rather than a recommendation, so you can redo it with your own
numbers.

A mid-range Android on Ugandan mobile data negotiates roughly **600 kbps** of
video. A consultation is two participants, and an SFU **forwards** streams
rather than transcoding them:

```
in   2 × 600 kbps = 1.2 Mbps
out  2 × 600 kbps = 1.2 Mbps
                    2.4 Mbps on the box, for one consultation

20 minutes → 2.4 Mbit/s × 1200 s ≈ 2,880 Mbit ≈ 360 MB
200 consultations/month          ≈ 72 GB
```

A relayed participant crosses this box **twice** — phone to coturn, coturn to
the SFU — so a fully relayed consultation is about 720 MB. Assume half of them
relay and budget **≈110 GB/month at 200 consultations**.

- **2 vCPU, 4 GB RAM, ≥2 TB transfer.** Roughly $12–25/month. Ten simultaneous
  consultations is ~24 Mbps and barely registers; forwarding is cheap, and no
  transcoding means no CPU cliff.
- **Check the bandwidth terms before the CPU count.** A provider that meters
  egress separately is the one that turns this into a variable bill again, which
  is the thing self-hosting was supposed to remove. At 110 GB/month even AWS-rate
  egress is about $10 — real, but not the number that decides anything at this
  volume.
- **The fixed bill dominates, and the operator's attention dominates that.** At
  200 consultations a month the media itself is a rounding error against the box.

Scale is not the risk here. A single node carries far more than a Phase 1 clinic
list will produce, and multi-node LiveKit (which needs Redis) is a problem for a
much later version of this file.

---

## What this actually costs

ADR-0004's argument *against* self-hosting is now the thing accepted, so it is
repeated here rather than quietly dropped:

> we operate real-time media infrastructure — TURN servers, bandwidth, scaling,
> and debugging one clinician's failing call at 9am with no operations engineer.

Concretely:

- **A VPS bill and a domain**, monthly, whether or not any consultation happens.
- **TURN bandwidth**, which is patients' media on our meter.
- **Certificate renewal that is not fully automatic**, because coturn needs the
  monthly restart above.
- **Call quality is our tuning.** Bitrate behaviour on a bad 3G connection is
  something a managed provider has specialists for, and we have this file.
- **Nobody is on call.** A consultation failing at 9am on a Tuesday is a founder
  reading logs, and the clinic is watching. There is no support contract and no
  escalation path.
- **The measurement in ADR-0004 is still outstanding.** No East African mobile
  network testing has been done. It is a blocker on the first production
  consultation, not a nice-to-have.

What it buys beyond the money: **media never leaves the region we chose.** That
is the strongest version of the DPPA-2019 residency position and it removes the
cross-border transfer from the H2 consent text entirely. It also removes a
dependency we could not have fixed when it broke.

---

## Recording is not configured, and must not be

Consultation recording is a standing non-goal, and ADR-0004's residency argument
rests on there being no store of consultation media to breach — only ephemeral
streams.

LiveKit Egress is the component that would create such a store, and self-hosting
is precisely when it becomes tempting: it ships in the same Apache-2.0
distribution already running here, and it is one more service in a compose file.

It is refused in three places on purpose — there is no egress service in
`docker-compose.yml`, `roomRecord` is written out as `false` in the grant the API
mints (`backend/app/Support/Video/LiveKitAccessToken.php`), and this section.
Adding it is a product and consent decision, not an operations one.

---

## Related

- [ADR-0004 — Consultation video transport](../../docs/70-decisions/0004-video-provider-selection.md)
- [Realtime & Video](../../docs/30-architecture/realtime-and-video.md)
- `backend/config/video.php` — the API side, and why the secret is write-only
- `backend/app/Support/Video/` — the provider, and the token it mints
