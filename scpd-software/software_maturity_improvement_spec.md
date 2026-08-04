# Smart Coop Software Maturity Improvement Spec

## Purpose

This document defines how to improve the current Smart Coop software in four areas:

- software design quality
- persistence and recoverability
- event accuracy and state correctness
- production maturity

It is written against the current codebase in `scpd-software/` as of August 1, 2026.

## Current Assessment

The project already has a workable separation of concerns:

- ESP32 firmware handles local protection logic.
- MQTT is the transport between device and backend.
- Node.js backend bridges MQTT to HTTP/WebSocket and stores data in SQLite.
- React frontend acts as the operator dashboard.

That is the right baseline architecture. The main weaknesses are in correctness guarantees and operational maturity, not in the basic choice of stack.

### Strengths

- Device protection is independent of the dashboard.
- MQTT credentials stay out of the browser.
- SQLite is appropriate for a small single-node deployment.
- The backend already exposes health and authentication boundaries.

### Main Weaknesses

1. The backend currently conflates device state and backend-side connectivity in ways that can reduce accuracy.
2. Persistence is event-light and does not yet support strong audit, replay, or recovery workflows.
3. Commands are accepted, but there is no end-to-end acknowledgement model proving the device actually applied them.
4. State changes are stored, but the schema does not preserve enough context for debugging real incidents.
5. Operational concerns such as retention, migrations, observability, and failure modes are not specified tightly enough.

## Design Goals

The improved system should satisfy these goals:

1. The dashboard must show what is true, not just what was last heard.
2. Every important action must be attributable, timestamped, and recoverable.
3. Device-originated facts and backend-derived facts must be modeled separately.
4. Commands must move through explicit lifecycle states.
5. The system must degrade safely when MQTT, the database, or the frontend is unavailable.
6. The design must stay small enough for a student project while being mature enough to defend technically.

## Target Architecture

Keep the high-level architecture, but make responsibility boundaries stricter:

- ESP32 firmware
  - source of truth for physical sensor and actuator state
  - emits status snapshots and event messages
  - emits command acknowledgements

- MQTT broker
  - transport only
  - retains selected state topics

- Backend
  - command coordinator
  - event ingester
  - state projector
  - audit log writer
  - frontend API and socket server

- Database
  - source of truth for historical events, commands, users, subscriptions, and backend projections

- Frontend
  - presentation layer only
  - renders current projected state and historical records

## Domain Model Changes

The current model is too small. Expand it into separate concepts.

### 1. Device Status

Represents last known device-reported values:

- `pir`
- `light`
- `armed`
- `online`
- `reported_at`
- `received_at`
- `device_session_id`

Important rule:
- `reported_at` is when the device says the status was true.
- `received_at` is when the backend received it.

If the device cannot yet provide `reported_at`, then use backend receive time temporarily, but keep both fields in the schema now.

### 2. Derived System Health

Separate from device status:

- `mqtt_connected`
- `database_healthy`
- `socket_clients`
- `backend_started_at`
- `last_mqtt_message_at`
- `device_stale`

Important rule:
- device online/offline is not the same as backend MQTT connected/disconnected.

### 3. Commands

Commands need their own lifecycle table:

- `id`
- `type`
- `payload_json`
- `requested_by`
- `requested_at`
- `publish_status`
- `published_at`
- `ack_status`
- `acked_at`
- `device_response_json`
- `failure_reason`

Command states should be:

- `pending`
- `published`
- `acknowledged`
- `timed_out`
- `failed`

### 4. Events

Events should become first-class records, not just a generic `type + detail`.

Minimum event fields:

- `id`
- `event_type`
- `source`
- `severity`
- `device_reported_at`
- `backend_received_at`
- `correlation_id`
- `payload_json`

Recommended sources:

- `device`
- `backend`
- `user`
- `system`

Recommended severities:

- `info`
- `warning`
- `critical`

## Persistence Improvements

### 1. Add Real Database Migrations

Current schema loading with `schema.sql` is fine for initial setup but weak for controlled evolution.

Add:

- a `schema_migrations` table
- ordered SQL migration files
- startup migration runner

This prevents silent schema drift and makes the design defensible.

### 2. Normalize Critical Records

Keep JSON for flexible detail, but do not rely on it for core operational fields.

Normalize:

- commands
- alerts
- state snapshots
- user actions

Use JSON only for optional extra detail.

### 3. Add Snapshot + Event Strategy

Use both:

- current-state projection table for fast reads
- append-only event table for history and audit

That gives:

- fast `/api/status`
- reliable incident review
- ability to rebuild state if projection logic changes

### 4. Retention Policy

Define retention explicitly:

- keep command records for the full project life
- keep predator alerts for the full project life
- keep noisy low-value state transitions for a shorter window, for example 30 to 90 days
- optionally aggregate older sensor churn into daily summaries

### 5. Backups

Minimum expectation:

- nightly SQLite backup
- restore procedure documented and tested

Even for a student project, backup and restore maturity matters.

## Accuracy Improvements

Accuracy is mostly a semantics problem, not a UI problem.

### 1. Introduce State Freshness

The current status endpoint returns values without a strong freshness judgment.

Add freshness fields:

- `lastDeviceMessageAt`
- `staleAfterMs`
- `isStale`

Rules:

- if no device message arrives within the configured interval, mark device state as stale
- stale is different from false
- the UI must visibly distinguish `offline`, `stale`, and `false`

### 2. Separate Facts From Inference

Examples:

- `pir = false` is a fact only if reported by device
- `device_stale = true` is a backend inference
- `backend_mqtt_disconnected = true` is backend health, not device fact

Do not overwrite one with the other.

### 3. Add Device Sequence or Correlation IDs

To improve ordering and duplicate handling, the firmware should emit one of:

- monotonic sequence number
- boot session ID plus sequence number
- UUID-like correlation token for alerts and command acknowledgements

This allows the backend to:

- detect duplicates
- ignore old retained messages when necessary
- reason about out-of-order delivery

### 4. Make Alerts Richer

A predator alert should carry context, not just `"1"`.

Recommended alert payload from firmware:

```json
{
  "event": "predator_alert",
  "deviceSessionId": "boot-20260801-001",
  "sequence": 184,
  "reportedAt": "2026-08-01T12:30:05Z",
  "armed": true,
  "light": true,
  "pir": true,
  "triggerSource": "pir"
}
```

If firmware complexity must stay low, start with:

- `sequence`
- `reportedAt`
- `triggerSource`

### 5. Acknowledge Commands End-to-End

Current flow proves that the backend published a command, not that the device applied it.

Add firmware acknowledgement topics such as:

- `coop/ack/deterrent`
- `coop/ack/arm`

Each ack should include:

- command ID
- success or failure
- reported time
- optional reason

The backend should only mark the command complete after ack or timeout.

## Software Design Improvements

### 1. Split Ingestion, Projection, and API Layers

The backend is currently small enough that concerns are still close together. That is fine, but the next step should separate modules by responsibility:

- `domain/`
  - command state machine
  - event definitions
  - state freshness rules

- `ingest/`
  - MQTT parsing
  - deduplication
  - validation

- `projection/`
  - current state projection
  - history projection

- `services/`
  - command service
  - event service
  - health service

- `routes/`
  - HTTP layer only

This reduces accidental coupling and makes tests simpler.

### 2. Replace Generic Stringly-Typed Events

Today many behaviors are based on free-form strings. Introduce explicit constants and validators for:

- MQTT topics
- event types
- command types
- command states
- health states

This will reduce hidden regressions and improve maintainability.

### 3. Create a Single Status Read Model

Instead of building status from mixed in-memory and database assumptions, create one canonical read model returned by `/api/status`.

The response should include:

- current device state
- freshness metadata
- backend health summary
- last alert summary
- active command summary if any

### 4. Reduce Implicit Side Effects

Functions like MQTT handlers should not both validate, persist, emit sockets, and trigger push side effects directly in one flow.

Preferred pipeline:

1. parse message
2. validate message
3. persist raw event
4. update projections
5. emit downstream notifications

That order improves recovery and debugging.

## API Maturity Improvements

### 1. Version the API

Adopt `/api/v1/...` now before the surface grows.

### 2. Return Explicit Timestamps and State Quality

Example `/api/v1/status` shape:

```json
{
  "device": {
    "pir": true,
    "light": true,
    "armed": true,
    "online": true,
    "reportedAt": "2026-08-01T12:30:05Z",
    "receivedAt": "2026-08-01T12:30:06Z",
    "isStale": false
  },
  "backend": {
    "mqttConnected": true,
    "databaseHealthy": true
  },
  "meta": {
    "generatedAt": "2026-08-01T12:30:06Z",
    "schemaVersion": 3
  }
}
```

### 3. Add Command Query Endpoints

Add:

- `POST /api/v1/commands`
- `GET /api/v1/commands/:id`

This is better than hiding command lifecycle inside unrelated route responses.

### 4. Add Pagination and Filtering

For events and state history:

- cursor or page-based pagination
- filtering by type, severity, source, time range

This matters once logs grow.

## Frontend Maturity Improvements

### 1. Represent Unknown and Stale States Correctly

Avoid binary UI assumptions. Some fields should support:

- `true`
- `false`
- `unknown`
- `stale`

This is important for trust.

### 2. Add Activity Timeline

Merge alerts, command submissions, acknowledgements, and state changes into one chronological operator timeline.

### 3. Expose Health Separately From Device State

The UI should show:

- device health
- backend health
- last contact age
- command delivery status

Do not collapse them into one status badge.

### 4. Improve Audit UX

Operators should be able to answer:

- who triggered a command
- when it was published
- whether the device acknowledged it
- what state the device was in at the time

## Firmware Contract Changes

The firmware should remain simple, but the message contract needs to mature.

### Required Additions

- periodic full status snapshot messages
- `reportedAt` or sequence-based ordering
- command acknowledgement topics
- explicit firmware version in startup or heartbeat payload
- device boot session ID

### Recommended MQTT Payload Direction

Move from raw string payloads to JSON payloads for:

- alerts
- acknowledgements
- heartbeat/status snapshots

Binary `"0"` and `"1"` payloads can remain for very simple compatibility topics during transition, but JSON should become the primary interface.

## Security and Reliability Improvements

### 1. Secrets and Environment Hardening

- require non-default admin password outside local development
- require non-default JWT secret outside local development
- document secret rotation procedure

### 2. MQTT Hardening

- prefer TLS in production
- use per-device credentials if multiple devices are introduced
- define topic authorization boundaries

### 3. Idempotency

The backend should tolerate duplicate MQTT messages and duplicate command submissions.

Use:

- sequence numbers for device events
- idempotency keys for command requests

### 4. Observability

Add structured metrics for:

- MQTT reconnect count
- message ingest failures
- command publish latency
- command ack latency
- stale-device intervals
- push notification failures

## Recommended Database Additions

Suggested new tables:

- `commands`
- `command_acknowledgements`
- `device_messages_raw`
- `device_status_projection`
- `system_metrics_samples`
- `schema_migrations`

Suggested upgrades to existing tables:

- `events`
  - add `source`
  - add `severity`
  - add `device_reported_at`
  - add `backend_received_at`
  - add `correlation_id`

## Implementation Roadmap

### Phase 1: Correctness Baseline

- add freshness logic to status
- separate backend health from device state
- add richer event schema
- stop treating backend MQTT connection as device truth

### Phase 2: Persistence Maturity

- add migrations
- add commands table
- add append-only raw device message log
- add retention policy

### Phase 3: Delivery Guarantees

- add command IDs
- add firmware acknowledgements
- implement command lifecycle API

### Phase 4: Frontend Trust Improvements

- render stale and unknown states explicitly
- add unified activity timeline
- add command delivery status UI

### Phase 5: Operational Hardening

- add backups
- add metrics
- add production deployment checklist
- add TLS and stricter secret validation

## Priority Recommendations

If time is limited, do these first:

1. Separate `device status` from `backend health`.
2. Add state freshness and stale detection.
3. Add command lifecycle persistence.
4. Add command acknowledgements from firmware.
5. Add database migrations and retention policy.

These five changes will produce the biggest gain in maturity and technical credibility.

## Definition of Done

The software design should be considered mature enough for the project when:

- status responses distinguish true, false, stale, and unknown correctly
- every command has a persisted lifecycle
- every important device event is timestamped and auditable
- backend restart does not lose authoritative state history
- API contracts are versioned and documented
- health reporting distinguishes device problems from server problems
- the system can justify its behavior during a review or demo without hand-waving
