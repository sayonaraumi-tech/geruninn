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

Business/document data remains local to each browser, as in the original application; this change does not add a shared database. The shared Google calendar is accessible to each authorized account, but local saved invoices are not automatically copied between devices/accounts.

The production service worker uses network-first application assets and a versioned cache. Only old `tsukinowa-pwa-` caches are removed. Google API/OAuth traffic is never cached. Cache updates do not clear localStorage. Mobile manifest behavior and the existing desktop/mobile layouts are preserved.

## Verification

- `node tests/static-and-sw.cjs`: syntax, preservation guards, PWA asset and service-worker tests.
- `node tests/serve-tests.cjs`: open http://127.0.0.1:8766 in a browser; the page runs isolated synthetic Calendar/OAuth and document-save tests. Use a separate localhost browser profile; only that local test origin is seeded with synthetic data. Repeat with desktop and mobile viewport sizes.
- Optional: install Playwright and its Chromium, then run `node tests/calendar-sync.cjs`.

Desktop and 390px mobile browser harness checks passed. Static/service-worker checks passed. Real Google OAuth consent and a live write from the second account were not exercised by these synthetic tests. The Google Cloud OAuth publishing/testing mode and calendar sharing ACLs remain managed in Google.
