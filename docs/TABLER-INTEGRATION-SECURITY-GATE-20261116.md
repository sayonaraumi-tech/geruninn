# Tabler UI integration — production security gate (2026-11-16)

Status: **NOT READY FOR RELEASE**. Branch only; do not merge or deploy without all gates passing.

## Source-of-truth
- Keep existing geruninn business and Firestore modules, IDs, accounting logic, PDF templates, legal documents and original snapshots as authoritative.
- Tabler v11/v13 is a **visual reference only**, not a replacement for the production accounting implementation.
- Demo file must not be committed to this public repository: it contains actual company invoice and payment details and client-side-only security logic.
- UI monetary presentation should show 円, not ¥; preserve validated numerical values and taxes.
- Fiscal year starts October 1 and ends September 30.

## Production requirements
1. Preserve desktop 9-page navigation with mobile modifications only as explicitly approved; theme color must be isolated from the printed PDF.
2. Documents: original 見積書・請求書・領収書・小野田 PDF output, invoice numbering, seals/logos and rounding unchanged except approved 値引き. Formal originals immutable; corrections create linked drafts and new official numbers.
3. Workflows: estimate acceptance permits unset work date; dated acceptance produces one deterministic calendar event; Google reconnect/retry does not create duplicates; document status updates calendar title consistently; cloud calendar changes never rewrite formal customer/amount/payment.
4. Accounting: cash receipts post once and cash payments immediately; card/bank transactions require bank evidence; representative advances never enter bank reconciliation; platform net receipts and fees are not double counted.
5. Bank CSV and expense CSV have separate import classification, duplicate prevention, amount/date identity and confirmation states; unassigned income/outgoings stay in monthly review queues until classified.
6. Security: Firebase company-scoped auth/role rules, admin-only mutations, atomic number reservations, revision preconditions, immutable audit history, idempotent replay, and blocked unsafe deletion.
7. Safety: no production data imported into local preview or test fixtures; no public test deployment with real company/client/banking details.

## Required validation (not yet executed on this branch)
- pnpm test
- pnpm test:rules
- pnpm test:browser
- pnpm test:business-browser
- pnpm test:document-numbering-browser
- pnpm test:estimate-calendar
- pnpm test:business-workflow
- pnpm test:expense-bank-browser
- pnpm test:release:local
- pnpm test:release:emulator
- Actual PDF visual/amount regression for all four types, including optional discounts, logos and seals
- Real browser screenshots for 9 desktop views and approved mobile views, all theme modes
- Production Google OAuth integration remains a separate **explicit, authorized** smoke test.

## Verified in the v13 standalone preview (not a production gate)
- 15 basic CSV/date/money/fiscal assertions passed
- Standalone JS syntax/build hash checks passed
- Legacy PDF code and CSS baseline hashes match v11
- These results do **not** establish Firestore transaction integrity, production permissions or Google Calendar behavior.

## Release rule
Keep `main` unchanged until source changes, all suite outputs, screenshot/print evidence and explicit owner acceptance are available.
