# Phase 2: realtime core business records

## Activation boundary

The repository now implements the seven core collections: `estimates`, `projects`, `documents`, `sales`, `payments`, `calendarLinks`, `auditLogs`, under `companies/{companyId}`. Firebase is still disabled in `firebase-config.json` because no production Firebase project has been created. Deploying these files to GitHub Pages does not provision Firebase, deploy Security Rules, grant roles, migrate a real browser, or enable live device sharing automatically.

Create the project, enable email/password Authentication and Firestore, deploy `firestore.rules`, provision trusted custom claims (`companyId: tsukinowa`, `role: admin|staff`) using the phase-one administrator script, then fill the public Web config and set `enabled: true`. See [phase-one setup](FIREBASE-PHASE-1.md). No service-account credential belongs in GitHub Pages. Roles are not granted by frontend email checks.

After configuration, sign in on each device. An administrator uses **クラウド → 旧データを安全に移行** on every device containing old records. The button reports progress, success, or failure. Do this before editing migrated work. Disabled configuration preserves the existing local application.

## Data model and invariants

- Each business record uses a versioned envelope: payload, revision, companyId, creator/editor, server timestamp, operation ID and audit ID.
- Documents have permanent IDs and a confirmed form snapshot. Invoice, estimate and receipt IDs are independent. Reopening/printing/downloading an unchanged snapshot performs no accounting write. PDF callbacks use the captured form, not whatever happens to be open when rendering finishes.
- Invoice/Onoda sales use `sale_{documentId}`. Estimates use `est_{documentId}` and do not create sales. Acceptance preserves the estimate and creates `project_{estimateId}`. Conversion from the same estimate reuses its invoice ID.
- Receipts explicitly select the target invoice. Each receipt creates `pay_{documentId}`; standalone collections have independent payment IDs. Multiple partial payments accumulate without changing the invoice amount. Customer-name guessing has been removed in shared mode.
- `salesDate`, `invoiceDate`, and `paymentDate` remain independent.
- Bank receipts start as `pending-bank`; matching an actual bank CSV line confirms an existing matching pending payment, rather than adding it twice. Multiple ambiguous candidates require review. A deterministic bank-row marker prevents duplicate reconciliation. Staff cannot confirm bank receipts or alter a bank-confirmed payment.
- Calendar links are keyed by a SHA-256 identity derived from Google event ID. Existing links retain calendarId, googleEventId, estimateId, projectId and document references. Calendar resync updates scheduling/raw source text, never formal document snapshots or amounts. Formal saves queue Google display updates; OAuth Calendar permission is still separately required.

## Realtime and conflict behavior

One listener per core collection per authenticated session hydrates the existing screens. Listener callbacks never invoke formal saves. Token/account transitions cancel previous listeners. Local cache/outbox keys include Firebase project, company and UID. Signing out clears business screens. Shared-mode Onoda drafts are separately scoped.

Commands are written to a durable local outbox before transmission. Transactions atomically write the business records, immutable operation marker, and before/after audit. Retry of the same operation cannot apply twice. Offline commands resume on reconnect and periodic retry. LocalStorage write failures stop the affected operation rather than claiming success.

Existing cloud records win migration conflicts. Interactive document changes use expected revisions: a stale save remains in the outbox with **同期エラー**. The administrator/user can export it or use **競合を保管して次の同期へ** to preserve the conflicting command in a separate local archive before moving on. Reopen the cloud document and apply the intended correction explicitly; there is no automatic whole-object last-writer-wins merge.

Top status: クラウド同期済 / 同期中 / オフライン / 同期エラー. The same four mobile tabs are retained. Staff page access is limited to schedule, estimates, documents and saved documents; receipt entry is available there. Desktop administrators retain the existing full navigation.

## Migration and backup

Before any migration write, save raw legacy strings plus parsed data into `tsukinowa_cloud_backup_*`. Corrupt JSON or failed backup prevents migration. Deterministic legacy IDs, create-if-absent transactions and a cloud `migrations/{sourceHash}` record with `migrationVersion: 2` make retry safe. Completed identical sources are skipped. A changed source is rechecked record-by-record without overwriting existing cloud records.

Original local keys are never removed or replaced by cloud snapshots. Old audit records are copied as immutable migration audit entries with the original record in `after.legacy`; importing actor/time remain trustworthy. Every newly migrated entity also has a migration audit.

Account-scoped local caches are automatic recovery copies, not a server-side disaster-recovery service. The cloud dialog exports all shared records plus unsent commands as JSON and sales as CSV. Production scheduled Firestore backups require project-side setup and are outside this stage. Expenses/bank CSV UI remain local and are out of scope for shared migration.

## Security Rules

Unauthenticated and cross-company access is denied. Staff may read core data needed for work and collections, and submit audited operational writes. Staff sales writes must correspond to a confirmed invoice/Onoda document with matching financial fields. Staff cannot write expenses, settings, migration markers, role grants or bank-confirmed payments. Admin may access all collections. Hard deletes of formal records, audit entries and operation markers are denied, including admin, during this rollout. Audit entries and idempotency markers are append-only.

Deploy these rules before enabling shared mode; frontend visibility is not security.

## Verification

- `pnpm test`: script syntax, service-worker assets/cache behavior, repository authorization/revision/idempotency tests.
- `pnpm test:rules`: real Firestore emulator tests covering roles, two-client listeners, estimates/acceptance, sales uniqueness, partial payments, Calendar protection, repeated migration, audit immutability, bank reconciliation and offline outbox recovery.
- `pnpm test:browser`: preserved Calendar/UI and cloud account regression checks at desktop/mobile widths.
- `pnpm test:business-browser`: actual 390px and 1280px pages using the real Firestore emulator. Tests estimate creation/acceptance, invoice save, three redownload callbacks, two partial receipts, offline reconnect and conflicting edits. Authentication is a test token adapter; PDF rendering is stubbed while the real `doPrint` and save callbacks run.

No real production users/data or live Google Calendar write is exercised by these tests. The real-device production acceptance run becomes possible after a Firebase project is configured.
