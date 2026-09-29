# Phase 3 — shared accounting and reconciliation

## Deployment and activation

This stage extends the existing GitHub Pages application. It does not create a Firebase project or enable the still-disabled `firebase-config.json`. Create/configure the project and trusted admin/staff claims as described in [phase 1](FIREBASE-PHASE-1.md), and deploy the **new Firestore rules before enabling the client**. No backend credential is shipped to the browser. The realtime repository and offline outbox from [phase 2](FIREBASE-PHASE-2.md) remain in use.

When cloud mode is enabled, expenses and bank records are no longer saved to the old local arrays. Admin sessions listen to `expenses`, `cashLedger`, `suppliers`, `supplierTransactions`, and `bankTransactions`, in addition to the core collections. Staff sessions listen only to operational core data; bank/supplier records and accounting audit reads are denied by rules. Existing four-tab mobile navigation is retained.

## Records, dates and corrections

All records have stable IDs. The repository envelope retains `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, server timestamps, revision, operation and audit IDs. Payloads contain:

- **expenses**: expenseId, expenseDate, category, vendor, description, amount, paymentMethod, bankAccount (`cash` for cash), receiptAttachmentRef, deletedAt. Categories: 材料費 / 給与 / 家賃 / 交通費 / 車両費 / 通信費 / 消耗品費 / 外注費 / その他. Attachment reference is reserved; this stage does not upload files.
- **cashLedger**: cashTxnId, date, income/expense type, category, description, amount, linkedPaymentId, linkedExpenseId, optional linkedSupplierTransactionId, deletedAt. `runningBalance` is a **derived read/export field**, recalculated from live entries sorted by date then stable ID; client-entered/stored balances are never trusted.
- **suppliers**: supplierId, supplierName, openingDate, openingBalance, currentBalance. Positive balance means prepaid credit; negative means payable.
- **supplierTransactions**: transactionId, supplierId, date, type (prepayment/monthlyInvoice/payment/adjustment), amount, description, invoiceMonth, paymentMethod, bankAccount, optional bankTxnId, deletedAt.
- **bankTransactions**: bankTxnId, bankTransactionDate, bankAccount, description, incoming, outgoing, amount, externalId/hash, occurrence, status, matchType/matchId/paymentId, reversal/exclusion details.

`salesDate`, `invoiceDate`, `paymentDate`, `expenseDate`, and `bankTransactionDate` remain independent. Bank confirmation uses the actual bank date for paymentDate and preserves invoice/expense dates. Soft cancellation keeps the source record and audit. Editing an expense uses its revision; bank-matched expenses must first be unmatched. Supplier monthly bills must be corrected through the supplier ledger, not separately through their generated expense.

## Cash, payments and receivables

A cash-received payment and its `cash_{paymentId}` ledger entry are written atomically. A cash expense similarly maintains `cash_{expenseId}`. Cash supplier prepayments/payments have their own linked cash entries. Changes or cancellations update/void the derived entry, never append another copy. Existing operation markers prevent repeated submission from applying twice.

Confirmed payments are live entries with `cash-received` or `bank-confirmed`. Pending bank payments and bank markers are excluded. Outstanding is invoice amount minus confirmed payment total, without clamping overpayments to zero. The receivables page includes sales date, invoice date, customer, billed/paid/outstanding amounts, last confirmed payment date, days since invoice and 未入金 / 一部入金 / 入金済 / 要確認 (including overpayment).

Admin can cancel a non-bank payment while retaining its document and audit. A bank-confirmed payment is reversed from its bank transaction. Bank reversal restores a previous pending payment, or soft-cancels the bank-created payment. It does not change the original invoice.

## Supplier monthly settlement

No project allocation is created. Supplier balance = opening credit + prepayments + payments + signed adjustments − monthly bills. Supplier transactions and their current balance update in one transaction, so concurrent writes retry against the current supplier record.

A monthly material bill has a deterministic ID derived from supplier and invoice month, and creates/updates one linked 材料費 expense. Prepayments and later settlement payments do not create that expense again. Cash settlement affects the cash ledger separately. Example: 1,000,000 + 1,000,000 − 1,438,620 = **561,380 prepaid credit**.

The current implementation treats one supplier/month as one consolidated monthly bill. To correct it, use 訂正; distinct monthly invoices from one supplier should be consolidated before entry. Cancelled invoices are retained and require review rather than silently recreating the same month.

## Bank CSV and matching

The importer accepts UTF-8 (optional BOM) and Shift_JIS, quoted delimiters and multiline descriptions. It locates a Japanese/English date header and requires description, incoming and outgoing columns. Supported examples: 日付/取引日/取引年月日/date, 摘要/内容/取引内容/description, 入金/入金額/deposit, 出金/出金額/withdrawal. Dates accept YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYYMMDD or YYYY年M月D日. Unsupported formats or invalid amounts are reported with a line number before import begins.

Use the same bank account label for the same account. Identity uses account + bank transaction ID when available. Otherwise it hashes account, normalized date/description, amounts, optional balance and identical-row occurrence number. Reuploading the same export keeps the same IDs. Identical transactions without a bank ID/balance cannot always be distinguished across differently overlapping export ranges; retain the source CSV and review such bank exports before confirming.

Suggestions use amount agreement, dates within seven days, and normalized name containment. They are only suggestions; no match is automatically confirmed. The administrator chooses an invoice/pending payment, expense or supplier payment and confirms explicitly. Amount-matching pending payments are confirmed in place; a partial invoice payment can create a bank-linked payment without changing the invoice. Each bank row can have only one active match. The displayed/exported status is 未照合 / 候補あり (derived) / 照合済 / 除外. Unmatch and exclude actions require a reason and are audited.

## Monthly reports and CSV

Monthly sales use salesDate, confirmed collections use paymentDate and expenses use expenseDate. Month-end receivables include sales dated on/before month end and confirmed payments through month end. Cash balance includes all live cash transactions through month end. Supplier reports show monthly prepayments/bills/payments and balance as of month end.

The four headline cards are 売上 / 入金 / 支出 / **収支差額**. Here 収支差額 explicitly means confirmed collections minus recorded expenses. It is not labelled as profit. Supplier advances do not duplicate the material-bill expense.

Exports: monthly summary, expenses, combined sales/payments, receivables, supplier ledger, bank reconciliation and cash ledger. Every CSV uses UTF-8 BOM, quoted fields and formula-prefix protection for spreadsheet text. Cancelled records remain identifiable in the relevant detailed exports.

## Legacy protection

The cloud-account dialog offers **旧支出・銀行記録を安全に移行 / 現金帳再構築**. It backs up original local strings and the phase-two account-scoped local expense/bank cache before writing. It validates all source rows, then creates only missing deterministic records. A migrationVersion 3 cloud marker prevents replay of a completed identical source. Failures retain original data and the backup; rerun safely resumes.

Previously matched legacy bank rows are imported as excluded, with the original row and an explicit review note. They are not used to generate a second payment. Existing cloud payments/expenses are used to rebuild missing cash entries. No legacy original key is deleted. Local-mode expense cancellation also keeps its record.

## Verification

- `pnpm test`: syntax, service-worker cache upgrade and repository authorization/revisions/idempotency.
- `pnpm test:rules`: real Firestore emulator, including cash atomicity/replay/cancellation, two repeated CSV imports, 100,000 − bank 50,000 − cash 20,000 = 30,000, bank pending confirmation/reversal, supplier 561,380 balance, expense categories, independent monthly dates, immutable audit, and forged staff write rejection at the rules layer.
- `pnpm test:business-browser`: actual desktop/mobile pages against the Firestore emulator, phase-two regression plus expense/cash controls, supplier entry, repeat bank upload, confirmation, monthly totals, staff navigation restrictions and all six requested CSV downloads with BOM checks.
- `pnpm test:browser`: preserved Calendar, Onoda/UI, account and local compatibility checks at desktop and 390px widths.

Authentication uses emulator test tokens and PDF rendering is stubbed in automated business browser tests. No production Firebase project, real bank CSV or live Google write has been exercised. Production cross-device acceptance is still pending Firebase project configuration.
