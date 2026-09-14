# Replace Your Existing Project With the Updated Code

This guide is for the project you originally downloaded as a ZIP. It updates the application code without replacing your existing Supabase data.

## Use the patch ZIP

The updated-files-only package contains:

- `coaching-center/` — every new or changed file, already in the correct folder structure.
- `REMOVED_FILES.txt` — old files that must be deleted from your existing project.
- `change-manifest.json` — the complete changed, added, and removed file list.

## Before replacing anything

1. Stop any running development server or deployment.
2. Make a complete copy of your existing project folder. Name it something such as `coaching-center-before-upgrade`.
3. Keep your existing `.env.local` separately. The patch does not contain this file, but you should still back it up.
4. Take a recoverable backup of the connected Supabase database before applying any SQL migration.
5. If the project uses Git, create a new branch or commit the current state before copying the patch.

## Replace the code without a terminal

1. Download and extract `coaching-center-updated-files-only.zip`.
2. Open the extracted `coaching-center` folder.
3. Open your existing project folder—the folder containing `package.json`, `src`, `server`, `api`, and `supabase`.
4. Select everything inside the patch's `coaching-center` folder.
5. Copy it into the root of your existing project.
6. When your computer asks what to do with files that already exist, choose **Replace** or **Overwrite**.
7. Open `REMOVED_FILES.txt` from the patch.
8. Delete each listed path from the existing project if it still exists.
9. Do not restore old copies of `src`, `server`, `api`, `netlify`, `scripts`, `supabase`, `package.json`, `vite.config.ts`, `netlify.toml`, or `vercel.json` over the patch. Those files contain coordinated changes and must stay together.

## Files and folders you must preserve from the existing project

Keep these locally; never upload them into source control or another ZIP:

- `.env.local`
- Any real credential or secret file kept outside the repository
- Hosting-platform environment variables
- Your Git history, if the project uses Git

Do not copy these from the old project into the upgraded source:

- `node_modules`
- `dist`
- `.netlify`
- `stats.html`
- `supabase/.temp`
- migration execution logs
- old credential JSON files

They are generated or machine-specific and can make the new release unsafe or inconsistent.

## Replace the code with Git or a terminal

From the existing project's root, first create a backup branch or commit. Then copy the contents of the patch's `coaching-center` directory over the project root while preserving paths. Afterward, delete every path in `REMOVED_FILES.txt`.

Do not run a command that deletes your existing `.env.local` or `.git` directory.

### Windows PowerShell cleanup

From the existing project root, remove generated output, editor mirror worktrees, local isolated-E2E credentials, and Supabase CLI state before installing or packaging the upgrade:

```powershell
$generatedPaths = @(
  ".kilo",
  "e2e/isolated-creds.json",
  "supabase/.temp",
  "dist"
)
foreach ($path in $generatedPaths) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}
```

`.kilo` contains editor-managed mirror worktrees, not source that should be tested or deployed. The other listed paths are generated or machine-local. This cleanup intentionally does **not** remove `.env.local` or `.git`.

If you are retiring the approved temporary isolated-E2E project, also remove its saved local configuration so a later run cannot silently reuse stale credentials:

```powershell
$isolatedConfig = Join-Path $HOME ".techely/hjzwbicauyxffrmdhvgy/isolated-runtime.json"
if (Test-Path -LiteralPath $isolatedConfig) {
  Remove-Item -LiteralPath $isolatedConfig -Force
}
```

Do not delete that saved file when you still intentionally use the approved temporary isolated-E2E project; rotate or replace it through the isolated setup workflow instead.

## Install and check the upgraded code

Use Node 24.15 or newer within Node 24 and pnpm 11.10.0.

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm test
```

The normal production build requires the real browser-safe deployment variables:

```bash
pnpm run build:production
```

A successful build also runs the release-cleanliness check.

## Update hosting environment variables

Keep your current Supabase values, but confirm all required variables from `.env.example` exist in Netlify or Vercel.

Required application identity:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_EXPECTED_SUPABASE_PROJECT_REF`
- `VITE_ENVIRONMENT_KIND`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EXPECTED_SUPABASE_PROJECT_REF`
- `ENVIRONMENT_KIND`

Derive the browser expected project reference from the configured Supabase URL; do not type or guess a different project ID. In Windows PowerShell:

```powershell
$env:VITE_SUPABASE_URL = "https://YOUR_20_CHARACTER_PROJECT_REF.supabase.co"
$projectRef = ([Uri]$env:VITE_SUPABASE_URL).Host.Split('.')[0]
$env:VITE_EXPECTED_SUPABASE_PROJECT_REF = $projectRef
```

Set `VITE_ENVIRONMENT_KIND=staging` for the populated showcase deployment and `VITE_ENVIRONMENT_KIND=production` for a customer deployment. Set the matching server-side `EXPECTED_SUPABASE_PROJECT_REF` and `ENVIRONMENT_KIND` values to the same project reference and environment class. For a PowerShell session, for example:

```powershell
# Populated showcase deployment
$env:VITE_ENVIRONMENT_KIND = "staging"
$env:EXPECTED_SUPABASE_PROJECT_REF = $projectRef
$env:ENVIRONMENT_KIND = "staging"

# For a customer deployment, use these instead:
# $env:VITE_ENVIRONMENT_KIND = "production"
# $env:EXPECTED_SUPABASE_PROJECT_REF = $projectRef
# $env:ENVIRONMENT_KIND = "production"
```

PowerShell `$env:` assignments affect the current process/session only. Enter the same values in the Netlify or Vercel environment-variable settings for the actual deployment. Keep project-reference and key validation enabled; a URL, expected ref, or key mismatch must fail closed.

Required messaging operations:

- `MESSAGING_WORKER_SECRET`
- `CRON_SECRET`
- `MESSAGING_TEST_RECIPIENT_ALLOWLIST`
- `MESSAGING_ENCRYPTION_KEYS_JSON`

`MESSAGING_ENCRYPTION_KEYS_JSON` must contain a current key ID and canonical Base64 values representing exactly 32 random bytes. Keep old keys in the keyring until all credentials encrypted with them have been replaced.

Built-in provider fallbacks are optional:

- MIM: `SMS_USERNAME`, `SMS_API_KEY`, `SMS_SENDER_NAME`
- Resend: `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_WEBHOOK_SECRET`

For a custom provider, add both:

- Its exact hostname to `PROVIDER_HOST_ALLOWLIST`
- Its exact complete HTTPS endpoint to `MESSAGING_CUSTOM_ENDPOINT_ALLOWLIST`

Do not put API keys, service-role keys, encryption keys, or worker secrets in variables beginning with `VITE_`.

## Apply database changes safely

Copying the patch changes code only. It does not update the connected database automatically.

### Existing populated showcase or temporary database

Do not run `canonical.sql`, the fresh-customer provisioner, or the complete staging installer against a populated database.

Use the populated upgrade workflow documented in `README.md`:

```bash
CUSTOMER_ID=showcase \
CUSTOMER_PROJECT_REF=YOUR_20_CHARACTER_PROJECT_REF \
CUSTOMER_ENVIRONMENT=showcase \
UPGRADE_ALLOWED_ENVIRONMENT=showcase \
CUSTOMER_DATABASE_URL='YOUR_DATABASE_URL_WITH_sslmode=verify-full' \
pnpm upgrade:showcase
```

This first run is read-only. Review the generated plan and backup requirements before enabling `UPGRADE_APPLY=1`. Do not guess which migrations have already been applied.

### New empty coaching-center database

Use `pnpm provision:customer` only for a new project with no application tables or business data. The fresh provisioner refuses populated targets.

## Recommended deployment order

1. Back up the project folder and database.
2. Copy the updated-files-only patch and delete paths in `REMOVED_FILES.txt`.
3. Run install, typecheck, lint, and tests.
4. Run the read-only database upgrade plan for the existing populated project.
5. Review and safely apply only the approved migration plan.
6. Configure the required hosting environment variables.
7. Deploy through Netlify or Vercel; do not upload an old `dist` folder.
8. Sign in as an authorized admin.
9. Open Admin → Settings → Messaging.
10. Select MIM, Resend, or Custom for each channel.
11. For Custom, enter the exact pre-approved endpoint and field mappings. Enter the API key through the write-only replacement field.
12. Save, run a dry test, then run one allowlisted live test with explicit confirmation.
13. Verify the messaging worker, Resend webhook, or SMS delivery status as applicable.
14. Test admission, fees, exams, notices, reports, uploads, backup, SMS, and email using disposable records.

## Important rules

- Never copy only the React page while omitting its server route or migration; this upgrade is coordinated across layers.
- Never run the full migration bundle on the populated showcase database.
- Never expose custom provider credentials in the endpoint URL, query string, static headers, payload mappings, browser storage, or `VITE_` variables.
- A custom provider without idempotency support uses at-most-once dispatch fencing. Ambiguous sends require manual review and are not automatically repeated.
- Keep the original project backup until the upgraded deployment and database checks are complete.
