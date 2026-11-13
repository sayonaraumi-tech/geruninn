# UI dependency and safe-cleanup audit (2026-11-12)

## Current source of truth

- `index.html`: main HTML, embedded legacy CSS, navigation, business page containers, and document editor/print markup.
- `js/accounting-ui.js`: dynamically rendered accounting, sales, cash and bank UI. Generated DOM must remain compatible with existing selectors and event handlers.
- `js/business-ui.js`: business/document presentation and calendar integration.
- `css/design-tokens.css` and `css/ui-foundation.css`: shared design baseline from PR #39.
- `css/desktop-nine-pages.css`: desktop-only migration from PR #40. Breakpoint is **min-width: 801px** because legacy mobile rules extend through 800px.

## Nine page roots

| Page | DOM root |
|---|---|
| HOME | `#pageDashboard` |
| 日程 | `#pageCalendar` |
| 見積履歴 | `#pageEstimates` |
| 帳票 | `#pageChohyo` |
| 保存帳票 | `#pageSavedDocs` |
| 売上・入金 | `#pageSales` |
| 支出・現金 | `#pageExpenses` |
| 銀行照合 | `#pageBank` |
| 設定 | `#pageSettings` |

## Preserve and do not delete

- All `id` values and `data-page` attributes: referenced by event handlers, navigation, persistence, tests or generated rows.
- `#pageChohyo` document preview, `.invoice`, `.invoice-wrapper`, print `@media` rules, PDF templates and document conversion events.
- Cash receipt automatic paid status, Google Calendar integration, sale/payment matching, bank reconciliation and duplicate-prevention logic.
- Existing `js/` module loading order, compatibility wrappers and Firestore rules.
- Existing responsive rules up to 800px; desktop changes must not override them.

## Cleanup candidates (NOT safe to delete without proof)

1. Repeated legacy `.biz-*` style declarations in the inline `index.html` CSS: identify cascade winners with browser computed-style comparisons before consolidation.
2. Legacy document-editor style rules: compare on-screen preview and PDF pixel output before removing anything.
3. Repeated navigation/form/table rules: measure desktop and mobile visual baselines, including 390px and 800px viewports.

No existing CSS selectors or business code were removed in this stage. Safe cleanup requires reference checks and visual/PDF regression tests first.
