# Compact HOME ledger

Based on main 34d0ae3 (includes merged PR #22, head 2b3e82e).

HOME renders exactly seven columns and one business row. The details/summary/dl template and its dedicated CSS are removed; no custom details event handler existed. CSV still uses LEDGER_HEADERS / ledgerCells with all eleven fields.

Sale HOME status reuses the period-end ledger result. A fully collected sale does not inherit stale pending-payment or bank-evidence labels. Partial/unpaid, review and duplicate warnings remain. Bank evidence is still verified by the existing bankEvidence helper and bank reconciliation workflow; no records are rewritten. Other HOME row statuses omit bank evidence labels.

Regression covers the 2026-10-07 塚居株式会社 112376 sale / 10-08 receipt, prior-month sales, split payments, cash, period cutoffs, complete exports, seven-cell DOM, absence of details DOM, compact row height and viewport overflow.

No production Firestore reads, writes, migrations, merges or deployments.
