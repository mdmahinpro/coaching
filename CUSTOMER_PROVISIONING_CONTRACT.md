# Customer Provisioning Contract

This document defines the provider-independent Phase 4 contract. It does not choose a billing provider, hosting provider, domain registrar, region, or paid Supabase-management plan.

## Required control-plane record

The external operator/control plane must maintain one record per institution:

```text
customer_id
customer_name
supabase_project_ref
supabase_region
supabase_url
application_deployment_ref
custom_domain
subscription_status
subscription_plan
provisioning_status
provisioning_run_id
migration_version
migration_manifest_hash
storage_version
auth_redirect_version
created_at
updated_at
suspended_at (nullable, lifecycle policy pending)
```

Secrets are not stored in this record. Use deployment secret storage or a vault.

## Provisioning states

```text
requested
project_assigned
schema_applying
schema_verified
storage_verified
settings_initialized
admin_pending
admin_invited
health_verified
handover_ready
failed
```

Every transition must be idempotent and append an audit event containing:

```text
run_id
customer_id
operation
started_at
finished_at
status
redacted_error
operator_id
```

## Required sequence

1. Register customer in control plane.
2. Require an explicitly assigned Supabase project/database.
3. Verify project URL/reference matches the assigned record.
4. Apply one canonical clean schema baseline.
5. Apply ordered incremental migrations.
6. Record migration filename/checksum/version.
7. Verify required tables, RPCs, grants, RLS, storage buckets, and storage policies.
8. Insert default settings only. Insert no students, teachers, fees, notices, exams, or demo business rows.
9. Invite/create the first administrator through a secure Auth flow.
10. Configure deployment environment and Auth redirect URLs.
11. Run empty-state, health, role-negative, and smoke checks.
12. Produce a redacted provisioning report and teacher handover packet.

## Current repository blocker

The current repository has ordered incremental migrations but does not yet have the required:

```text
supabase/schema/canonical.sql
```

Some current migrations assume tables already exist. `scripts/provision-customer.mjs` therefore fails closed for apply mode and reports this blocker instead of applying an incomplete or unsafe schema.

## Phase 4 implementation status

The repository now contains a safe dry-run/provisioning entry point:

```text
pnpm provision:customer
```

Dry-run inputs:

```text
CUSTOMER_ID
CUSTOMER_NAME
```

Apply-only inputs:

```text
PROVISION_APPLY=1
CUSTOMER_DATABASE_URL
```

The command emits a redacted JSON report under `provisioning-reports/`, includes
ordered migration SHA-256 checksums, and will use a `provisioning_migrations` ledger
to detect checksum drift. It currently refuses to apply because the canonical clean
schema baseline is not yet approved/created.

## Explicitly excluded from this contract

- Billing provider.
- Subscription suspension/deletion/refund policy.
- Domain registrar/DNS automation.
- Region choice.
- Hosting provider.
- Full Supabase project creation API.
- Auth invite delivery provider.

Those choices require an explicit product/operations decision.
