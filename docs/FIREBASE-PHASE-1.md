# Firebase first phase — foundation, not data cutover

## Review of the existing application

The production base is `00f7cc30654cdda0f529678d604879fedfc734f3`.

- `index.html` contains the UI, Google Calendar integration, document generation and accounting handlers. Keep those handlers in place during this phase.
- `tsukinowa_business_v1` stores one JSON object with `calendar`, `estimates`, `projects`, `sales`, `payments`, `expenses`, `bank`, and `audit` arrays. `bizPersist()` overwrites that whole object. `renderBank()` calls `autoSuggestBank()`, which also persists, so merely refreshing the UI causes a local write.
- `tsukinowa_chohyo_confirmed_history_v1` stores saved invoice/estimate/receipt/Onoda form snapshots. These have stable `historyId` values and event/estimate/project links.
- `tsukinowa_business_settings_v1` stores local settings. Monthly Onoda drafts, invoice sequence counters, last tab and scroll position use separate keys.
- Invoices and Onoda invoices create/update sales by document `sourceId`; estimates are maintained separately until acceptance. Receipt and bank matching paths have their own payment writes. These are not yet atomic across the business JSON and document history.
- Date naming needs an explicit migration: current forms use `salesDate`; sales rows use `saleDate`, `invoiceDate`; payments use `date`. Preserve all original dates and add normalized `salesDate`, `invoiceDate`, `paymentDate` only in a reviewed migration.
- Legacy risks for subsequent phases: customer-name matching for receipts, bank matching that can duplicate an existing payment, local invoice-number collisions between devices, and local audit trimming. Do not automatically mirror this whole state to Firestore.

## What this phase changes

The existing navigation and accounting/document logic remain local. A small cloud-account button opens a login/status dialog on desktop and mobile. It offers an explicit JSON backup of all application localStorage keys, including raw values, old drafts and invoice sequence counters. Reading and exporting never clears or rewrites source data, including malformed JSON.

`firebase-config.json` is intentionally disabled because no Firebase project exists yet. No real Firebase login, production rules deployment or business-data migration has occurred. Disabled configuration loads no Firebase SDK and initiates no Firebase connection. Missing configuration/network errors leave the legacy application available.

The independent repository `TsukinowaCloud.getClient()` supports:

- Firebase email/password authentication with session persistence; no password is stored by application code. Google Calendar OAuth remains separate.
- Trusted custom claims `companyId` and `role` (`admin` or `staff`). Users cannot choose their own role. Unknown roles or wrong companies fail closed.
- Real-time subscriptions to individual records or allowed collections; all subscriptions are removed on signout, token changes, auth errors and account changes. Late results from prior identities are ignored.
- Explicit per-record writes with optimistic revisions, deterministic caller-supplied operation IDs, SHA-256 payload fingerprints, and an atomic record + operation + audit transaction. A failed transaction leaves no partial writes. Offline writes are rejected by Firestore transactions, not silently treated as synced.
- Memory-only Firestore cache. Cloud snapshots never overwrite legacy `bizState` or localStorage. The login dialog listens to `settings/system` only to verify connectivity.

The old bulk cloud-save hook was removed rather than connected to a snapshot overwrite. `bizCloudReady` remains false. Logging in does **not** turn on business synchronization or hide legacy local pages; the cloud role protects the cloud API/rules only in this phase. Do not treat the retained local UI as a secured shared-device accounting session yet.

## Data model and permissions

All records are under `companies/{companyId}/{collection}/{recordId}`. The common envelope is:

```
{ schemaVersion: 1, companyId, payload, revision,
  createdBy, updatedBy, updatedAt, lastOperationId }
```

| Collection | Future legacy mapping | First-phase access |
| --- | --- | --- |
| calendarLinks | calendar; calendarId + eventId identity | admin read/write, staff read |
| estimates | estimates; stable estimate ID | admin read/write, staff read |
| projects | projects | admin read/write, staff read |
| documents | confirmed history; historyId | admin read/write, staff read |
| sales | sales; stable document sourceId | admin |
| payments | payments; separate amount and paymentDate | admin |
| expenses | expenses | admin |
| suppliers | new supplier master | admin |
| cashLedger | new cash ledger | admin |
| bankTransactions | bank rows/reconciliation identity | admin |
| settings | company settings | admin; staff may read `system` only |
| auditLogs | append-only transaction audit | admin read/create; nobody may update/delete |
| operations | immutable idempotency markers | admin read/create; nobody may update/delete |

Staff write access, cash collection forms and document-confirmation writes are deferred until the corresponding workflows are integrated atomically. All hard deletes are deliberately disabled during rollout, including for admins. This temporary rule is narrower than the final admin workflow; later explicit void/archive operations must retain accounting and audit history. No anonymous access, client role changes, cross-company access or recursive wildcard grants are permitted. Admin business writes must include the matching audit and operation records in the same transaction.

Example for a trusted admin caller after login:

```js
const cloud = TsukinowaCloud.getClient();
const stop = cloud.listen('projects', null, (rows, metadata) => { /* render separate cloud view */ });
await cloud.put('projects', 'stable-project-id', { name: 'Example' }, {
  operationId: 'stable-operation-id', expectedRevision: 0
});
stop();
```

This is a low-level foundation API, not a replacement accounting save handler. Financial multi-record invariants will be introduced with the next phases.

## Activate after a Firebase project exists

1. Create/register a Firebase Web app and enable Email/Password in Authentication. Add `sayonaraumi-tech.github.io` as an authorized domain. Create the intended admin/staff users using the Firebase console or another trusted administrator workflow. There is no public signup button.
2. Create Cloud Firestore in the intended region using locked/production rules, not open test rules.
3. Install development dependencies (`pnpm install`). Deploy only rules/indexes with `pnpm exec firebase deploy --only firestore --project YOUR_PROJECT_ID`. GitHub Pages remains the host; `firebase.json` has no Firebase Hosting configuration.
4. In a trusted operator environment, configure Application Default Credentials. Run `node scripts/set-cloud-role.cjs YOUR_PROJECT_ID USER_EMAIL admin tsukinowa` (or `staff`). This changes signed custom claims and revokes refresh tokens. Never put a service-account key, admin credential or user password in this repository or a browser. Users must sign out/in after role changes.
5. Fill the public Firebase Web configuration in `firebase-config.json` and set `enabled: true`. The Web config is an app identifier, not an authorization boundary; Firestore rules enforce access. Commit the configuration and deploy via the existing GitHub Pages workflow.
6. Verify both roles and the Firestore connectivity message on phone and computer. `settings/system` may not exist initially; a successful empty read still confirms access. Reconnect/login does not import old data.

Do not enable real shared business writes until migration and workflow integration are complete.

## Next stages (not executed)

1. Export and verify a raw local backup; migrate by stable IDs using a company migration marker, content hashes, atomic batches and restartable progress. Only mark complete after verification. Preserve originals on both success and failure; do not set a migration marker now.
2. Wire document confirmation and accounting transactions to Firestore. Keep invoice amounts distinct from receipts/payments; support partial payments and bank-confirmed status. Keep estimates out of sales until accepted. Preserve all Onoda pricing/toll/tax rules. Calendar text cannot write official document/accounting fields.
3. Switch business views to real-time subscriptions and introduce staff cash/field workflows with corresponding tested rules. Restrict admin pages and isolate any compatibility data by authenticated account before shared-device use.
4. Add scheduled trusted-server backups, cloud JSON/CSV export, supplier management, audit browsing and reconciliation. Existing local CSV/JSON exports remain available today.

## Validation

- `pnpm test`: JavaScript syntax, legacy preservation, PWA assets/network bypass, and core lifecycle/idempotency tests.
- `pnpm test:rules`: requires Java 21; uses only `demo-tsukinowa` in the Firestore emulator. Tests anonymous/cross-company denial, staff scope, unsafe writes, transactions, immutable audits, and independent-client real-time observation.
- `pnpm exec playwright install chromium` then `pnpm test:browser`: existing Google Calendar + document regression and the cloud dialog/backup/login flow at 1280px and 390px. OAuth/Firebase login is mocked; no live business data is touched.

References: [Firebase Web setup](https://firebase.google.com/docs/web/setup), [custom claims](https://firebase.google.com/docs/auth/admin/custom-claims), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions).
