# HOME business rows and payment status

Scope: PR #17, verified initial head `8e8f38801027a0de67ce4bd74a08837c4f903f4a`. Review only; no merge/deploy or production Firestore reads/writes.

## Display and totals

HOME previously appended every sale and every payment as independent rows, even when they shared an explicit sale ID. It also called all non-bank expenses 未照合. The replacement removes those separate rendering paths. HOME and its monthly/year/custom CSV share `ledgerRows`, `LEDGER_HEADERS`, and `ledgerCells`; expense-page and HOME status share `expenseStatus`.

A sale and its explicitly linked payments now appear as one business row. Displayed sales are only sales in the selected period, cumulative collected amounts stop at period end, period receipts stop at both period boundaries, and collection dates list each confirmed installment. Prior-month collections retain the original sales date, say 過月売上の入金, and contribute zero new sales. Receivable-only anchors remain non-sales. Pending payments remain an 入金確認待ち warning on the business row and contribute no receipts. Confirmed unlinked payments remain standalone 要確認 rows and are included once in receipt KPIs/channels, never in sales or invented receivables. Review counts use business IDs to avoid counting an unpaid business twice.

The 塚居株式会社 112,376円 synthetic regression verifies one linked business, pending payments, partial receipts and cross-month collections. A distinct second sale remains a separate record and row. Same-day/customer/amount sales are only marked 重複候補・要確認, never hidden or merged. This is a code and fixture diagnosis, not certification of production Tsukai IDs. No historical record was inspected, rewritten, marked duplicate, deleted, or repaired.

## Cash and advances

Cash expenses say 支払済, regardless of bank-evidence flags, and remain ineligible for bank matching. Representative advances say 立替未精算 and never deduct company cash. Existing cash mirrors only record actual cash payments. Bank-match status is displayed separately from payment status; card settlement protections are unchanged. 月締 remains 支払待ち.

There is no existing audited reimbursement record/command model in this repository. A memo, arbitrary settled/reimbursed flag, or bankTxnId is not reliable reimbursement proof. Therefore this limited change never claims 精算済. Adding a new reimbursement workflow is outside this PR's deliberately limited scope.

## Verification

- Static syntax/PWA checks and 151 unit/regression tests, including 4 new business-row tests.
- 37 real localhost Firestore Rules/integration tests; unchanged rules.
- HOME browser at 390/1280px: month/year/custom, KPI/CSV, partial cross-month Tsukai collections, cash/advance statuses, no page overflow.
- Real-emulator browsers: accounting-events, expense-bank (manual category change learns; active rule reuse, disable/edit/delete, CSV/dedup, cash isolation, incoming recommendations), business, outstanding, historical import and document numbering.
- Browser suites: onoda, navigation/PWA upgrades, calendar-sync, cloud, receipt-calendar (12 new/legacy combinations), business-workflow, estimate-calendar, auth-persistence. Formal PDF views/redownload remain zero-write; Calendar and GMO parsing are retained.
- `git diff --check`.

All writes were isolated in-memory or localhost demo-tsukinowa fixtures. No production migration and no new dependency, reimbursement collection, deployment, or Firestore rule change.
