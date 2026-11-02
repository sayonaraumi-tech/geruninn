# HOME cash flow presentation validation

Based on main 05515c0. Frontend-only HOME projection; ledgerRows, aggregate, ledgerCells and all exports are unchanged. Removed the old inline HOME row template in favor of compact presentation helpers. Seven columns, shared estimate typography and black/gold navigation remain.

- Prior-period collection: 入金, green plus, original sale date and payment evidence in title; no date or accounting changes.
- Confirmed incoming amounts take precedence over sale amounts; uncollected sales stay neutral without plus.
- Expenses red minus; supplier prepayments display independently as 前渡金（費用計上なし）, without changing expense KPI or exports.
- Visa debit merchant prefix and approval/TID suffix stripped only in HOME. Expense content uses recorded category or 内容要確認, without guessing.
- Text cells clamp to two lines with full display text available as title; raw evidence stays in bank view/database/CSV.

Validation: existing unit suites passed (18 + 171 tests), Firestore emulator rules passed (44 tests, demo-tsukinowa only). HOME browser passed 320/390/768/1280/1920px, period switching, CSV, shared theme, no page overflow, read-only rendering. Synthetic regression fixtures use the requested dynast dates 2026-10-13 / 2026-10-31 and amounts 1012740 / 1594900 against prior-period sales, cash purchase, unknown content, interest 2679, neutral unpaid sale and prepayment. These reproduce the requested cases; production records were not accessed or changed. No merge/deploy.

