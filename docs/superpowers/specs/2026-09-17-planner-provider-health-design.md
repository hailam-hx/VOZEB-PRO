# Planner Provider Health / Circuit Breaker Design

## Classification

This is an architectural change. It extends the persistent provider-health identity and PostgreSQL schema, then makes Agent Planner routing use that shared subsystem. It does not create a second circuit-breaker implementation.

## Current architecture

Agent Planner resolves text candidates, orders them with `rankTextPlanningCandidates()`, creates a durable planner attempt, dispatches the provider request, settles billing, and parses the response into either a conversation reply or creative plan. The ranking function uses a process-local map and a 30-second cooldown. That map is lost on restart and is not shared across instances.

TextTask routing already uses `ProviderHealthService` through `provider-health-runtime.ts`. It persists binding and channel records, supports CLOSED, DEGRADED, OPEN, and HALF_OPEN states, atomically leases one recovery probe, and records safe transition events. Planner does not currently call this subsystem.

## Identity and persistence

`ProviderRouteIdentity` gains `workloadScope: "planner" | "text_task"`. The existing `scope: "binding" | "channel"` field remains the health-record level. Both are required and serve different purposes.

All binding keys, channel keys, cache keys, store operations, locks, and HALF_OPEN leases include `workloadScope`. A Planner channel aggregate for S7J7 is therefore disjoint from the TextTask channel aggregate for S7J7.

PostgreSQL gains a non-null `workload_scope` column constrained to `planner` or `text_task`. The migration runs transactionally, checks for re-key collisions before mutation, maps every existing row to `text_task`, and preserves its payload, counters, timestamps, cooldown, and lease fields. Existing keys are re-keyed to include `text_task`. Channel records continue to store the deterministic model sentinel `*`; no unique rule depends on PostgreSQL NULL equality. A composite unique constraint covers `workload_scope`, record `scope`, provider, channel, and model in addition to the scoped primary key.

## Planner routing flow

The Agent Planner flow becomes:

1. Resolve candidates in configured priority order.
2. Rank them through persistent `planner` health; stable ordering preserves configured priority within the same health state.
3. Acquire the binding/channel route or atomically claim a HALF_OPEN probe lease.
4. If blocked, emit scoped `provider_route_skipped` and continue locally. Do not create a planner attempt, billing attempt, or provider request.
5. If allowed, create the durable planner attempt and dispatch the provider.
6. Observe exactly one provider outcome.
7. Parse and validate the creative plan independently.

The Agent Planner bypasses process-local health for eligibility and ordering. The local planning runtime remains available to other callers and may retain protocol latency telemetry, but its cooldown cannot skip or deprioritize an Agent Planner candidate.

## Outcome semantics

Provider success is recorded only after a valid terminal stream/protocol completion. HTTP 200, first byte, and first public text are insufficient.

Provider overload, 429, 5xx, timeout, reset, upstream unavailability, model unavailability, and auth/config failures follow the existing provider-health classifier. User cancellation, request/business/domain errors, billing failures, and internal parser errors do not count toward the circuit.

A valid terminal stream followed by an invalid creative plan records provider success, then emits a sanitized `planner_invalid_plan` quality event. Parse failure cannot roll back that success or increment provider failure counters.

Each dispatched candidate owns an observation guard. The provider terminal path sets success once. The catch path reports a failure only when success was not already observed and the existing classifier says the failure counts. Planner settlement and later Agent lifecycle failures never produce another provider-health observation.

## HALF_OPEN safety

The existing atomic store update remains the single-probe authority across processes. A normal terminal observation clears the lease. If a request dies after acquire and before observation, the lease expires at `halfOpenProbeUntil`; a later acquire may claim a new probe. An explicit release helper is used when dispatch cannot start after acquisition, returning the record to OPEN without extending cooldown. Lease expiry remains the final crash-safe path.

## Channel aggregate

Binding and channel observations share the same workload scope. One model failure cannot open a channel; the existing independent-model threshold remains authoritative. Planner failures affect only Planner aggregates, and TextTask failures affect only TextTask aggregates.

## Observability and operations

Health events include `workloadScope`, provider, channel, model, state, and safe failure metadata. Generation Operations exposes separate Planner and TextTask health for text bindings and renders compact labels. It never combines counters across workloads.

## Billing and lifecycle invariants

Skipped routes have no planner attempt, usage, billing, or settlement side effect. Dispatched planner calls retain the current billing contract. Agent Run lifecycle, task state transitions, plan settlement, public-text behavior, and TextTask fallback semantics remain unchanged.

## Test strategy

Unit tests cover scoped keys and isolation, all failure classes, terminal-success/invalid-plan semantics, no double observation, OPEN skip, HALF_OPEN recovery/failure/expiry/release, stable ranking, channel aggregation, and process-local bypass. PostgreSQL integration tests cover transactional migration, persistence, restart behavior, collision detection, and atomic multi-instance leases. Agent executor tests verify skipped routes create no attempt or billing activity. Operations tests verify separate scope output. Existing provider-health, logical-router, TextTask, Agent, billing, and stream protocol suites provide regression coverage.

## Risks

- A partial migration could orphan old keys; transactional DDL/DML and collision checks prevent this.
- Reporting success before protocol terminal would hide interrupted streams; the observation is tied to the request helper's terminal completion result.
- Parse errors could double-observe after success; the per-dispatch guard prevents catch-path failure reporting.
- Local ranking could silently override persistent decisions; Agent Planner no longer invokes it.
- A crashed probe could remain blocked; scoped lease expiry guarantees eventual recovery.
