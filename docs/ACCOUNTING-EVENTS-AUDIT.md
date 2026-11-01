# 売上・入金・領収書 audit (PR #17)

Review base: `a47e42783fe6d8d5c16cdc27427c4eeb323e8ea8`. Review only; no merge or deployment. No production Firestore reads/writes, migration, cleanup or historical repair was performed. All fixtures are synthetic; Firestore integration uses localhost `demo-tsukinowa`.

## Reported Masuda event

2026-10-23 / （株）益田工房東京 / クロス張替 / ¥79,500 is reproduced in isolated tests. One `売上` row plus one `入金` row is correct when both refer to the same sale: HOME sales = ¥79,500, receipts = ¥79,500, outstanding = ¥0. The sale ledger row has incoming=0; the payment row has incoming=¥79,500. These are separate measures, not ¥159,000 of revenue or receipts.

This does not certify the actual production records. The screenshot supplies neither sale/payment IDs nor the complete relationship graph. Existing disconnected duplicates cannot safely be inferred from date, customer and amount alone.

## Findings and fixes

1. Attaching bank evidence to a confirmed payment used to overwrite paymentDate/date, method and memo. Preserve confirmed business data; record the statement date separately as bankTransactionDate. Pending bank payments still adopt the confirmed bank date. Unmatch restores the prior payment; rematch reuses its ID.
2. Issuing a later invoice for a calendar/receipt sale reused its ID but moved salesDate. Keep the existing revenue date in both the sale and document accounting metadata. Explicit formal revisions retain their existing correction behavior.
3. Creating a receipt for an already-confirmed invoice payment double-counted the reused payment in its overpayment guard. Exclude that same payment ID from the sum of other collections.
4. Normal manual payment commands lacked a general balance guard. Check confirmed and pending reserved amounts before a new payment; re-read the sale/payment IDs within the transaction. Concurrent commands contend on the sale paymentVersion/paymentIds write. Replay of the same operation/ID remains idempotent, and real separate installments within the outstanding balance remain possible.
5. Legacy confirmBank is also balance-guarded. An unlinked confirmed payment must use the current bank-match screen rather than create a second collection through the compatibility route.
6. UI hydration used to enqueue historical receipt/calendar repair, including duplicate cancellation. Remove this automatic write path. Old missing links and long titles remain unchanged on login/reload. Explicit compatibility repair commands remain in the domain for previously persisted operations; no repair/migration is run by this review.

## Path audit

| Path | Accounting behavior |
| --- | --- |
| Formal receipt save | Reuses explicitly linked invoice/receivable, calendar sale and compatible payment. Independent receipt creates one sale/payment. Conflicts are atomic and require review. |
| Invoice -> sale | Stable sale identity; later invoice evidence retains existing sales date. Repeated formal output is read-only. |
| Calendar sale registration | Stable calendar anchor and aliases prevent repeat creation. Cash creates one confirmed payment/cash mirror; noncash stays unpaid until confirmation. |
| Cash/manual payment | Stable operation/payment identity; new IDs cannot exceed confirmed/pending outstanding balance. Cash mirrors are excluded from business receipt totals. |
| Bank CSV/match | Import dedup and transaction replay retained. Reuse pending/confirmed payment, no new sale/document/receipt. Confirmed receipt dates are preserved. |
| Historical PDF import | Original number/hash/tuple reservations retained. Default creates receivable-only anchor, no revenue; explicit sale creation or existing-sale linking remains reviewed. Bank/receipt reuse that anchor. |
| HOME/monthly ledger | Sales by salesDate, confirmed payments by paymentDate, outstanding as of period end. Bank statement rows and linked cash mirrors do not add revenue or receipts. |

## Validation

- Full package test commands: syntax/PWA and 147 unit/regression tests (6 + 141), including 7 new cross-path tests.
- Firestore rules suite: 37 cases, including a new real concurrent full-collection test. No rules changes.
- New real-emulator browser suite: 390px and 1280px, both same-day Masuda and September-sale/October-collection fixtures; confirmed payment -> formal receipt -> repeated bank CSV -> November evidence attachment -> HOME/ledger -> reload snapshot preservation.
- Receipt/calendar browser suite: 12 combinations of receipt/invoice/Onoda, new/legacy and mobile/desktop; new saves/Google retries retained, legacy login/reload stays read-only.
- HOME ledger browser suite: desktop/mobile month/year/custom periods and CSV export.
- Existing business browser regression checks formal save/revision, partial collections, PDF output with zero accounting writes, bank and cash behavior.
- `git diff --check`.

Run the added integration suite with `pnpm test:accounting-events-browser`. In this review the package test commands were executed directly with Node because pnpm attempted an unavailable project-store symlink. Browser/Firestore processes required localhost access. No production credentials are used by these tests.

## Remaining limits / release decision

- Actual production Masuda IDs and counts have not been inspected. No assertion that historical duplicates have been cleaned or are absent.
- Two disconnected manual documents/events with different IDs cannot be reliably identified as one business event from matching text/amount alone. Explicit links and review are necessary; legitimate equal installments must remain distinct.
- Ambiguous multiple payments, mixed/combined deposits and conflicting dates/methods remain manual-review cases. No silent merge or allocation.
- Confirmed paymentDate is the accounting authority. If a user entered an incorrect confirmed date, evidence attachment will preserve it; correction requires a separately reviewed action.
- Removed hydration repairs leave incomplete historical graphs untouched. Previously queued explicit repair commands still require queue review before a future release.
- Balance checks are in the shared application transaction layer. Existing Security Rules preserve role/tenant/audit/relationship protections but do not implement an independent aggregate balance calculation against deliberately crafted admin writes.
- No production migration, cleanup or deployment is included. User decides release after reviewing PR #17.
