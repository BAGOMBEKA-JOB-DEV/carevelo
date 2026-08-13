<?php

use App\Broadcasting\ConsultationChannel;
use App\Broadcasting\DispatchBoardChannel;
use App\Broadcasting\PatientChannel;
use App\Broadcasting\PharmacyQueueChannel;
use App\Broadcasting\RiderChannel;
use App\Broadcasting\TenantChannel;
use App\Broadcasting\UserChannel;
use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast channel authorisation
|--------------------------------------------------------------------------
|
| Every channel Carevelo has. All private, all tenant-prefixed, no exceptions,
| and no platform-wide channel -- there is deliberately no such thing.
|
| Each handler is a class in app/Broadcasting extending TenantPrefixedChannel,
| which runs the two checks together and cannot be given only one of them:
|
|   1. the channel's tenant prefix against the AUTHENTICATED SESSION's tenant,
|      audited on mismatch, because a mismatch is either a bug or an attack;
|   2. the SAME POLICY the REST API runs for the same data, so realtime
|      permissions cannot drift away from HTTP permissions.
|
| Names come from TenantChannel and nowhere else. Registering a pattern by
| hand here would be the one place an unprefixed channel could enter the
| system, which is exactly why nothing here is a literal.
|
| Note what is ABSENT: Laravel's default `App.Models.User.{id}` notification
| channel. It carries no tenant prefix, so it is not a channel this system may
| have -- personal notifications go to tenant.{tenantId}.user.{userId}.
|
| @see docs/30-architecture/realtime-broadcasting.md
| @see docs/50-security-compliance/rbac-matrix.md
|
*/

Broadcast::channel(TenantChannel::PHARMACY_QUEUE, PharmacyQueueChannel::class);
Broadcast::channel(TenantChannel::DISPATCH_BOARD, DispatchBoardChannel::class);
Broadcast::channel(TenantChannel::USER, UserChannel::class);
Broadcast::channel(TenantChannel::PATIENT, PatientChannel::class);
Broadcast::channel(TenantChannel::RIDER, RiderChannel::class);
Broadcast::channel(TenantChannel::CONSULTATION, ConsultationChannel::class);
