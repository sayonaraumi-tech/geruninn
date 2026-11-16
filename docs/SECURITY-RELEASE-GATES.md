# Financial Security Acceptance Gates — Tsukinowa

**Status: NOT CERTIFIED / production deployment blocked.** This document is an evidence checklist, not evidence of compliance.

## Scope / preservation
- Repositories: `sayonaraumi-tech/geruninn`, `sayonaraumi-tech/linchen`; Firebase tenant `tsukinowa`.
- Never alter production financial records, legacy originals, UI/PDF templates or bank reconciliations during security testing.
- Security rules are **not deployed** by merging a GitHub branch. Production verification requires privileged Google Cloud access and a separate approval.

## Gate 1 — supply chain (block until pass)
- Audit both the production client and development/administrator toolchain separately.
- CI `pnpm audit --audit-level high` or `npm audit --audit-level high` must pass after lockfile regeneration; do not suppress high advisories or use `--force` without documenting a migration.
- Upgrade transitive packages in a controlled dependency-update branch. Review lockfile diffs and rerun all browser/PDF/firestore tests.
- Git history Gitleaks findings: distinguish Firebase **public web** API key (verify restrictions, not confidential by itself) from possible genuine secrets; redact report, rotate actual secrets if found, and review exposure in historical commits.
- Document any audited exception including exact package, CVE/GHSA, installed version, runtime reachability, mitigation, owner and expiry. No blanket exceptions.

## Gate 2 — finance integrity (block until pass)
- Malicious-client emulator tests for direct Firestore mutations to bankTransactions, payments, cashLedger, documents, sales, auditLogs, operations and settings.
- Test anonymous, staff, admin and cross-company credentials.
- Deny unauthorized payment confirmation, reversal, cash entry, historical backfill, deletion, reassignment and forged audit. Verify optimistic revisions and the transaction ties the operation, audit and business records.
- Verify duplicated operation IDs cannot create duplicate funds, invoice numbers or ledger rows.
- Reconcile a fixed isolated fixture's sales, payment, cash and bank totals before/after backup and restoration.
- Server-side trust boundary for high-risk workflows remains to be approved. Client-side code checks are not sufficient authorization.

## Gate 3 — Google Cloud & live rules (requires privileged operator)
- Record Firebase project, Firestore database, deployed rules release hash, IAM roles, service account scopes and API-key **API restrictions** (no values of credentials).
- Verify that live rules match the approved tested policy; make a timestamped, read-only production assessment before any deployment.
- Review MFA for Cloud project owners and application administrators, recovery paths and session/revocation behavior.
- Never deploy rules blindly; a rules upgrade can lock out valid staff or disrupt accounting.

## Gate 4 — independent recoverable backups (requires privileged operator)
- Create a separate restricted Cloud Storage bucket near Firestore; use a dedicated least-privileged export identity.
- For scheduled managed Firestore exports, configure Cloud Scheduler/Functions only after billing, retention, recovery location and pricing approval.
- Preserve electronic transaction originals, source PDF/CSV, immutable audit history, document versions and associated metadata separately; managed Firestore exports alone do not prove all originals are backed up.
- Perform restore **into isolated nonproduction database only**, with distinct IAM and test accounts. Compare document counts, linked IDs, balances, invoice numbers, files and hashes.
- Record export timestamp, storage path, data scope, checksum evidence, restoration time, tests, failure/recovery procedures and owner.
- Never trigger test import against the production database.

## Gate 5 — Japanese electronic transaction record retention
- Verify distinction between 電子取引, 電子帳簿, スキャナ保存 and ordinary PDFs. Requirements differ by category and exceptions.
- Keep original electronic invoices/receipts/CSV with integrity and retrieval; revision/deletion control or appropriate documented administrative rules; readable export, searches and system overview documentation for custom software.
- Obtain tax accountant assessment of company-specific applicability before claiming legal compliance.

Official sources:
- National Tax Agency: https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/07denshi/02.htm
- Firestore managed exports: https://firebase.google.com/docs/firestore/solutions/schedule-export
- Firestore export/import: https://firebase.google.com/docs/firestore/manage-data/export-import
- Firebase API keys: https://firebase.google.com/docs/projects/api-keys
- Firebase MFA: https://firebase.google.com/docs/auth/web/multi-factor

## Gate 6 — minimization, no blind deletion
- Keep Firebase Auth/Firestore client SDK needed for runtime.
- Isolate `firebase-admin`, `firebase-tools`, `@firebase/rules-unit-testing` and Playwright from live browser code.
- Only remove libraries after verifying actual imports, test dependencies, public UI, original PDF output, bank flows and offline outbox compatibility.
- Re-run the complete release checks and deny merge if any gate remains red.

**Acceptance rule:** all gates pass with links to CI runs, live cloud read-only evidence, restoration report and tax review. An unmerged PR with green code tests is not equivalent to live compliance.
