# 月輪合同会社 業務システム

Production site: https://sayonaraumi-tech.github.io/geruninn/

The application was restored from the last complete upload (`fd28363`) on top of the empty main commit (`c1007809`), retaining the original document, Onoda, estimate and business interfaces.

## Calendar connection

1. Open 日程 → Googleに接続 and grant both Calendar events and CalendarList read access. Existing users must consent again to grant the added scope.
2. The exact calendar name `月輪合同会社 業務システム` is preferred after login. The selector also supports manual choice. Reader access is sufficient to import; writer/owner access is required to update Google events.
3. Choose a month and sync. Boundaries use Asia/Tokyo. CalendarList and events are paginated; events are keyed by source calendar plus Google event ID. Cancelled events, Japanese holiday entries and rest/leave titles are excluded from incoming data. Existing business records are never automatically removed.
4. Save the linked invoice, estimate or receipt through the existing PDF save action. Customer, official amount, status and a system link are written to the original calendar event. Remote notes are preserved and ETag conflicts are retried. A failed update remains pending locally and is retried on month sync.

## Data and PWA

Existing localStorage keys and saved records are retained. No startup reset, automatic old draft deletion or 500-document truncation is performed. Calendar text updates cannot overwrite linked formal records. Saved documents restore their original event link.

With Firebase disabled, business data remains local. With Firebase configured and enabled, the seven core collections use realtime shared storage; existing local records require the explicit safe migration described below.

The production service worker uses network-first application assets and a versioned cache. Only old `tsukinowa-pwa-` caches are removed. Google API/OAuth traffic is never cached. Cache updates do not clear localStorage. Mobile manifest behavior and the existing desktop/mobile layouts are preserved.

## Verification

- `node tests/static-and-sw.cjs`: syntax, preservation guards, PWA asset and service-worker tests.
- `node tests/serve-tests.cjs`: open http://127.0.0.1:8766 in a browser; the page runs isolated synthetic Calendar/OAuth and document-save tests. Use a separate localhost browser profile; only that local test origin is seeded with synthetic data. Repeat with desktop and mobile viewport sizes.
- Optional: install Playwright and its Chromium, then run `node tests/calendar-sync.cjs`.

Desktop and 390px mobile browser harness checks passed. Static/service-worker checks passed. Real Google OAuth consent and a live write from the second account were not exercised by these synthetic tests. The Google Cloud OAuth publishing/testing mode and calendar sharing ACLs remain managed in Google.

## Firebase foundation (phase 1)

The cloud-account dialog, Firebase Auth adapter, isolated Firestore repository, role rules, idempotent transactions and raw local JSON backup are now present. Firebase remains **disabled by default** because a project has not yet been created. Existing Calendar, document and accounting functions continue using localStorage. No data migration, production role provisioning or live business synchronization has been performed.

See [the code/data review, permission model, setup steps and phased migration plan](docs/FIREBASE-PHASE-1.md). Run `pnpm test`, `pnpm test:rules`, and `pnpm test:browser` for the corresponding checks. GitHub Pages deployment is unchanged.

## Firebase realtime business sync (phase 2)

The existing pages now connect to realtime estimates, projects, documents, sales, payments, Calendar links and audit logs. Stable document IDs, transactional accounting, partial receipts, offline outbox, conflict protection and backup-first migration are implemented. Firebase remains disabled until a project is created and configured. See [activation, data model, migration and test details](docs/FIREBASE-PHASE-2.md). Phase-two behavior supersedes the phase-one rollout notes when shared mode is enabled.
