# Formal originals and independent workflows

Opening a stored estimate, invoice, receipt or Onoda document locks its inputs. PDF output renders the stored snapshot and does not enqueue or execute a save, allocate a number, or post accounting/Calendar records. Changing original fields programmatically is rejected. The administrator’s revision action creates a separate draft and retains the audited original. Snapshot rendering does not refill missing dates or recalculate Onoda prices/tolls.

New documents are durable in the account-scoped outbox before Firestore is contacted. Google is a background dependency only. Firestore must be available to allocate a globally unique formal number; while unavailable, the draft remains pending and an explicit reason is visible. Independent receipts create no sales/payments; an explicitly linked receipt records its payment with the receipt date.

Ordinary document filenames share category inference and use YYYY-MM-DD_customer_categories_document-type.pdf. Categories are deduplicated with ・ and inferred dynamically for old snapshots; receipts fall back to linked invoice content or 但し書き. Illegal filename characters, including the CF category’s slash, become underscores.

Estimate issue date and optional work date remain distinct. Acceptance uses an existing work date without prompting, or succeeds undated. Date assignment uses stable project, local Calendar and Google event identifiers; concurrent/repeated assignment addresses one event. Google changes update the schedule while formal customer, amount, document status and confirmed payments remain authoritative. Google reconnection retries pending create/patch operations; 409 reuses the existing deterministic event.

Only an explicitly parsed customer, work, positive amount and 現金 create an event-anchored calendar-cash sale, cash-received payment and cash mirror. Ordinary events create schedules only. Unlocked cash events update their existing records; a formal invoice takes over the same sale anchor. Cancellation or loss of cash/amount information retains accounting and marks review required.

Voiding requires an administrator reason and blocks any live payment, excluding bank markers and soft deletions. The original snapshot and audit remain; its sale/receivable becomes nonlive and leaves dashboards, receivables and payment choices. Repeated void is idempotent. Firestore failures expose error codes/reasons separately from Google disconnected/pending states. Backup readiness reads repository state rather than UI badge text.

## Validation

Run the normal test suite, test:rules, test:browser, test:business-browser, test:document-numbering-browser, test:outstanding-browser, test:historical-browser, test:auth-persistence, test:estimate-calendar and test:business-workflow. Browser fixtures cover 390px/1280px; use HTML2PDF_BUNDLE for actual A4 PDF rendering. Production credentials and customer data are not used by the tests. Deploy firestore.rules to tsukinowa-business with the authenticated Firebase CLI as well as publishing main to Pages.
