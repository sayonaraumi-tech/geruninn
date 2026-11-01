# Bank candidates and expense classification learning

Base: production main `0aef706bef37ec6a3e55ad22aed1604d4a567490` (PR #16).

## Reported Dynast deposit

The old suggestion helper only read sales/receivables, compared the bank date to the invoice/sales date within seven days, and did not read invoice due dates. The old dropdown also only enumerated sales/payments: a document without a live accounting anchor could never appear there. Already-confirmed receipt payments were also omitted from recommendations once the outstanding amount reached zero.

The supplied regression fixture is a 2026-10-31 deposit of 1,594,900 yen, description `ダイナスト（ド`, linked to the 2026-09-30 invoice `20260930-001`, customer `dynast合同会社`, due 2026-10-30. It now appears in the dropdown with exact amount and near-date/due-date reasons. Latin `dynast` is deliberately not treated as proven equivalent to Japanese `ダイナスト`: the candidate says `名称要確認`. No customer-specific hardcoded alias is installed.

This is a code/fixture diagnosis, not a claim to have inspected or repaired production Firebase records. If the production document lacks a live sale/receivable link, its candidate is visible but disabled (`売上・未収リンク要確認`); bank confirmation cannot invent a sale. Normal historical imports already have a receivable anchor.

## Incoming candidate policy

- Read active, confirmed invoice/receipt documents, live sales and receivables, pending bank payments and already-confirmed unlinked bank payments.
- Exact yen amount is mandatory. Invoice, sale, payment and due dates contribute to scoring. Seven-day proximity ranks highest; dates up to 120 days after the invoice/due date remain reviewable candidates. No candidate is selected or confirmed automatically.
- Normalize width, whitespace, case, Japanese legal-form abbreviations and kana for recommendation names. Different scripts are not guessed or transliterated.
- Display candidate reasons, invoice number, customer and remaining balance. Confirmed receipt payments remain selectable with zero outstanding and reuse their existing payment ID.
- Existing transactional bank matching, balance checks, replay protection, bank evidence links and unmatching are retained. No receipt document, document number, sale or Calendar event is created by recommendations/confirmation.
- Cash-received payments and cash receipt/calendar sources do not become bank candidates. Representative advances are excluded. Outgoing matching retains exact amount/seven-day expense matching and cash/advance/card-settlement restrictions. Unmatched withdrawals still require explicit user entry and confirmation through the shared expense helper.

## Classification learning

- The user explicitly checks the learning box when saving a reviewed expense. Expense and rule writes use the existing audited transaction; import/render never learns silently.
- Rules live in company-scoped admin-only `settings` records, one stable ID per normalized vendor. Existing settings permissions and audit/version conflict checks apply. No Firestore rules change is required.
- Safe key: NFKC width normalization, lower case, trim and collapse whitespace. Keep legal forms, punctuation, digits and word boundaries. Match the whole key; no fuzzy/substring classification. Multiple conflicting rules require review.
- Manual vendor changes and explicit bank-to-expense entry prefill from active rules. Expense CSV supplied categories win; blank categories use active rules. Unruled blank categories are marked `要確認` and need explicit acknowledgement before importing as `その他`. Invalid supplied categories still block import.
- View, edit category, disable/re-enable and delete rules on the expense page. Deletion is an audited tombstone. Historical expenses are never rewritten. New manual transactions can intentionally re-learn a disabled/deleted rule.
- Existing UTF-8/Shift_JIS decoding, six-field expense deduplication, GMO bank ID/hash/occurrence deduplication, raw description/memo/balance preservation and import behavior remain unchanged.

## Validation

- `pnpm test`: syntax/PWA plus 140 unit/regression tests, including Dynast, confirmed-payment reuse, conservative learning, CSV precedence, ambiguous/missing rules, atomic learning, optimistic edits and historical preservation.
- `pnpm test:browser`, `node tests/business-workflow-browser.cjs`, `node tests/estimate-calendar-browser.cjs`, `node tests/home-ledger-browser.cjs`, `pnpm test:auth-persistence`: desktop/mobile navigation, Calendar, formal versions, PDF zero writes, ledger and authentication persistence.
- Firestore emulator: `node --test tests/firestore-rules.cjs` and expense-bank, business, outstanding, historical-import and document-numbering browser suites. Expense-bank browser coverage includes real audited rule writes, prefill, disable/edit/delete, unchanged expense history and the Dynast dropdown without selecting/writing anything.

All emulator tests use `demo-tsukinowa`. No production data is mutated. This branch is for PR review only; do not merge or deploy automatically.
