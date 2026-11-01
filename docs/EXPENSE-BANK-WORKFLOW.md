# 支出・銀行照合の単一フロー

## Scope and removed paths

Based on main `8c30f2e`.

- Removed the inline `matchBankExpense`, its outgoing amount-only first-candidate selection and its old confirmation button from `index.html`.
- Disabled local-only expense creation and bank importing in the active UI. New records use the existing authenticated accounting service and durable queue.
- Removed outgoing supplier-payment targets from the bank UI and suggestion helper. Supplier history, balances and existing command replay/unmatch remain compatible.
- Removed the old accounting migration / cash rebuild button and its frontend migration implementation. No migration runs during startup or import.
- Removed the extra expense supplement card. Existing bank-account / attachment references are preserved when editing, without adding required entry fields.
- Moved cash adjustment inside the cash ledger and bank account options inside bank CSV importing.
- Verified that the existing bank import domain only saves bank evidence; it does not create expenses. Matching continues to update an existing expense, never create a second expense.

Sales/incoming suggestion scoring, pending-payment confirmation, payment channels and bank unmatching are retained. Legacy supplier/migration domain commands remain for queued commands and historical data compatibility; they have no new UI entry point.

## Current workflow

1. Enter date, category, method, amount, vendor and description manually, or preview an expense CSV with headers `日付,科目,支払方法,金額,取引先,内容・備考` (UTF-8 or Shift_JIS).
2. Review row count, eligible total, errors and each duplicate candidate. Errors block importing; exact duplicates in existing live records, the pending queue and the file are skipped.
3. Both entry paths use `saveExpense`, the same validation and the same cash mirror. Only `現金` debits cash. Date/category/amount/vendor/method/description form the stable key. Newly entered exact duplicates share a server-derived ID, including concurrent/repeated CSV imports. Existing IDs and historical records are not rewritten.
4. Import bank CSV. This creates payment evidence only.
5. Outgoing candidates require exact amount, a date within seven days, an unmatched live expense, and bank transfer/direct debit (including legacy GMO bank). Corporate cards, representative advances, cash and other methods are excluded.
6. A single candidate with matching vendor text is `自動一致`; weaker/ambiguous candidates are `候補`; no candidate is `未一致`. These are computed display states. Both candidate types still require explicit confirmation. Confirming writes the existing bank link and `照合済`; the expense ledger displays `支払確認済`. No expense is added.
7. For unmatched non-card evidence, `この銀行明細から支出登録` asks for confirmation and opens the usual entry form. The user must save the expense and then confirm its bank match separately.

## Card settlement limitation

Monthly card debits remain `未一致` with `カード決済まとめ候補` and an explanation that they cover multiple expenses. Version one deliberately has no one-to-many association UI. No automatic expense creation or one-to-one card matching is available, including through the expense-match domain command. Individual corporate card expenses stay in the expense ledger and do not debit cash.

## Compatibility and validation

No Firestore rules, production data, Google Calendar records or historical schemas are changed. Existing bank links are readable and reversible. The PWA cache version changes to load the new UI.

- `pnpm test`: includes expense CSV parsing, six-field keys, cash isolation, legacy/manual duplicate detection, concurrent/repeated imports, bank evidence/match replay/unmatch, card protection and incoming suggestion compatibility.
- `pnpm test:rules`: existing real Firestore emulator permission and accounting coverage.
- `pnpm test:browser`: existing document/navigation/cloud/calendar regressions.
- `pnpm test:business-browser`: existing sales, expense/cash, bank incoming, invoice/receipt/estimate and historical supplier regressions with the emulator.
- `pnpm test:expense-bank-browser`: real UI and unchanged emulator rules for preview/duplicates, cash/noncash, high confidence, candidate confirm/cancel, unmatched explicit creation and monthly card protection.

The referenced original 20-row attachment is not present in this checkout. Tests use the requested six-column format and payment methods; they do not claim to import that production file or validate its stated total.
