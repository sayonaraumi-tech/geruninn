# 第二阶段功能覆盖矩阵

基准：PR #54 `8c4e7230574c9a308de4efef9476fca3e30129a8`；UI SHA-256 `70f0be803af51e88507f9983262f173e963a8fd52e9f6d628d08063756afd28f`。

“回归文件”表示相关场景的实际回归证据，不等于所有可能数据组合或每个按钮状态已穷举。独立客户主档在第一阶段不存在；本轮没有虚构该数据模型。

| 页面 | 有效功能 | 明确入口 | 业务接口 | 数据 | 回归文件/证据 | 状态 |
|---|---|---|---|---|---|---|
| 全局 | 九页导航、深链接、返回/前进、延迟 Google 加载 | bizSwitchPage / #bizNav | 业务页面路由守卫 | 无数据写入 | navigation.cjs | 保留并接入 |
| 全局 | 五套主题、手机完整授权导航 | tabler-ui.js / tabler-v13.css | 显示适配层；沿用角色权限 | 仅 tsukinowa_ui_theme_v13 | tabler-ui-browser.cjs | 本轮新增 |
| ホーム | 月次/年度/自定期间、确认入金/未收/支出、要确认 | homePeriod / renderDashboard | Accounting.aggregate / YearEnd.effective | sales,receivables,payments,expenses,bankTransactions,cashLedger | home-ledger-browser.cjs; sales-period-browser.cjs; accounting-events-browser.cjs | 保留并接入 |
| ホーム | 期间台账、分类/入金渠道、CSV 一致性 | homeLedger / accountingExport | ledgerRows / settlementExport | 同上 | sales-period-browser.cjs; ledger-cleanup-browser.cjs | 保留并接入 |
| ホーム | 当年度与前年度月次比较、期间收支 | tablerAnalytics | YearEnd.annual / Accounting.aggregate | 现有有效数据，只读 | tabler-ui-browser.cjs; visual-baseline.cjs | 本轮新增 |
| ホーム | 年末资料、审计筛选、年度 CSV | homeSettlement / yearEndExport | YearEnd.exports / checks / audit | 全部业务集合及 auditLogs | navigation.cjs; business-browser.cjs; year-end.cjs | 保留并接入 |
| ホーム | 完整 JSON 备份、导入校验预览 | exportBackup / importBackup | YearEnd.backup / validateBackup | 同步记录；未同步时禁止导出 | navigation.cjs; year-end.cjs | 保留并接入 |
| 日程 | 完整42格月历、闰年、跨年、上月/下月/本月 | tablerMonthGrid | TablerCalendar.cells / shift | calendarLinks 投影 | tabler-calendar.cjs; tabler-ui-browser.cjs | 本轮新增 |
| 日程 | 按日期登记系统日程，标题安全显示 | 日期按钮 / ＋予定登録 | BusinessUI.enqueue(calendar) | calendarLinks,operations,auditLogs；不因現金文字入账 | tabler-ui-browser.cjs | 本轮新增 |
| 日程 | 搜索、审核/隐藏记录、详情及账票入口 | calendarKeyword / calendarReview / openEventModal | calendar / registerCalendarSale | calendarLinks,sales,payments,cashLedger | calendar-sync.cjs; business-workflow-browser.cjs | 保留并接入 |
| 日程 | 管理员显式日程销售登记、现金确认 | eventSaleForm | registerCalendarSale | sales,payments,cashLedger,calendarLinks | business-workflow-browser.cjs; accounting-events.cjs | 保留并接入 |
| 日程 | Google OAuth、共享日历分页、ICS 导入 | Google 同步 / 设置 | calendar / calendarPrepareCreate / calendarCreated / calendarPatched | calendarLinks,estimates,projects | calendar-sync.cjs; receipt-calendar-browser.cjs | 接入保留；真实 OAuth 账户未现场测试 |
| 日程 | 正式保存反向更新、ETag 冲突重试 | 原账票/受注操作 | 原 Google 同步路径 | 明确 googleEventId 与 calendarId | calendar-sync.cjs; estimate-calendar-browser.cjs | 保留并接入 |
| 見積履歴 | 搜索、日期排序、已开票过滤、受注/日程未定 | estimateRows / bizAcceptEstimate | acceptEstimate / estimateInvoices | documents,estimates,projects,calendarLinks | estimate-history-layout.cjs; business-browser.cjs; estimate-calendar-browser.cjs | 保留并接入 |
| 見積履歴 | 确定 ID 关联开票、原件只读、取消后历史 | requestEstimateInvoice / 保存帳票 | saveDocument / documentStatus | documents,sales,estimates | business-workflow-browser.cjs; estimate-issued-history.cjs | 保留并接入 |
| 帳票 | 請求/見積/領収/小野田、正式编号、税额/折扣 | 原表单及正式保存 | prepareFormalOutput / saveDocument | documents,sales,payments,cashLedger,operations | document-numbering-browser.cjs; business-browser.cjs | 保留并接入 |
| 帳票 | 右侧持续预览、真实下载和保存快照 | previewArea / doPrint | 保留原 A4/PDF 渲染路径 | 同一 invoice DOM；原编号/快照 | onoda-browser.cjs; PDF逐页对比 | 本轮适配；16组PDF比对通过 |
| 帳票 | 独立现金領収的原子 sale/payment/cash 镜像 | 領収正式保存 | saveDocument / mirrorCash | documents,sales,payments,cashLedger | business-workflow-browser.cjs; firestore-rules.cjs | 保留并接入 |
| 帳票 | 现金請求不自动收款，银行待确认不计入入金 | 原方法选项和入金登记 | payment confirmation 契约 | sales,payments,cashLedger | payment-paths-browser.cjs; payment-paths.cjs | 保留并接入 |
| 帳票 | 小野田日程明细、数量、固定定价、跨页、前月未收 | 小野田請求 / importOnodaFromCalendar | 原 onodaTotals 及明细引擎 | calendarLinks,documents,sales | onoda-browser.cjs; onoda-repair.cjs; PDF逐页对比 | 保留并接入 |
| 保存帳票 | 查询、呼出、重下载不重复记账、原件保护 | savedDocSearch / openSavedDoc / redownloadSavedDoc | saveDocument只在正式新保存；下载只读 | documents,sales,payments | business-workflow-browser.cjs; document-numbering-browser.cjs | 保留并接入 |
| 保存帳票 | 改订、无效、重复制票、归档及误生成受审计清理 | 原管理操作按钮 | documentStatus / archiveDocument / deleteMisregistration | documents,相关账项,备份,auditLogs,operations | business-browser.cjs; ledger-cleanup-browser.cjs; firestore-rules.cjs | 保留并接入 |
| 保存帳票 | 历史 PDF 解析、重复校验、扫描件回退、确认后入库 | 历史PDF导入 | historicalPdfImport | documents,sales或receivables,编号占用 | historical-import-browser.cjs | 保留并接入 |
| 売上・入金 | 权威销售台账、期间、截止日、排序、详情、CSV | salesRegisterTable / receivableAsOf | Accounting.salesRegister / receivables | sales,receivables,payments,documents | sales-period-browser.cjs; outstanding-browser.cjs | 保留并接入 |
| 売上・入金 | 部分/最终入金、四种渠道、银行确认 | paymentRegistrationForm / 余额面板 | payment / confirmBank | payments,sales/receivables,cashLedger,operations | payment-paths-browser.cjs; outstanding-browser.cjs | 保留并接入 |
| 売上・入金 | 安全的销售登记入口 | 請求書で売上登録 | 打开原帳票→正式保存 | 沿用原正式编号和销售事务 | tabler-ui-browser.cjs | 本轮替换只显示提示的手动按钮 |
| 支出・現金 | 支出登记/修改/取消、凭证引用、重试幂等 | 原支出表单与台账 | saveExpense / deleteExpense | expenses,cashLedger,auditLogs | expense-bank-browser.cjs; expense-register.cjs | 保留并接入 |
| 支出・現金 | 支出 CSV 预览、重复检测、分类学习 | expenseFile / expenseImportPreview | saveExpense / saveExpenseCategoryRule | expenses,settings | expense-bank-browser.cjs; expense-register.cjs | 保留并接入 |
| 支出・現金 | 现金出纳、收入支出和受审计调整 | 现金账及调整表单 | cashAdjustment / mirrorCash | cashLedger,payments,expenses | business-browser.cjs; expense-bank-browser.cjs; accounting-events-browser.cjs | 保留并接入 |
| 銀行照合 | CSV、账户别名、重复识别、分类规则学习 | bankFile / bankRules / bankRows | importBank / saveBankRule | bankTransactions,settings | expense-bank-browser.cjs; bank-learning.cjs | 保留并接入 |
| 銀行照合 | 已有 payment 复用、部分入金、候选确认/取消 | 照合確定 / accountingConfirmBank | bankMatch / bankUnmatch | bankTransactions,payments,sales/receivables | expense-bank-browser.cjs; bank-evidence-browser.cjs; payment-paths-browser.cjs | 保留并接入 |
| 銀行照合 | 支出补录、卡片汇总核销、平台净额/手续费分配 | 原内嵌核销区域 | expenseFromBank / bankMatch | expenses,payments,bankTransactions | expense-bank-browser.cjs; payment-paths-browser.cjs | 保留并接入 |
| 銀行照合 | 杂收入/利息/返还、排除及恢复 | 原分类与排除按钮 | reviewBankIncome / bankExclude | bankTransactions；不新增业务销售 | bank-evidence-browser.cjs; bank-home-ledger.cjs | 保留并接入 |
| 銀行照合 | 供应商、前渡金、月次实际材料费、抵扣及订正 | 東鵬｜前渡金管理 | saveSupplier / supplierFromBank / settleSupplierInvoice | suppliers,supplierTransactions,expenses,bankTransactions | supplier-prepayment-browser.cjs; business-browser.cjs | 保留并接入 |
| 銀行照合 | 历史重复候选备份/只读审计 | 重复明细审核区 | bankCancelDuplicate / bankRestoreDuplicate 始终禁止 | 不删除生产银行记录 | bank-duplicate-cancel.cjs; bank-evidence-browser.cjs | 按第一阶段安全限制保留禁用 |
| 設定 | 登录/注销/认证恢复、可信角色 | クラウド账户 / 系统设置 | CloudCore / FirebaseDriver | Firebase Auth / 租户声明 | auth-persistence.cjs; cloud-browser.cjs; navigation.cjs | 保留并接入 |
| 設定 | 旧数据备份迁移、账号范围缓存、同步队列、阻塞保管重试 | cloudMigration / cloudRetryQueue / cloudArchiveQueue | migration* / Sync.enqueue / flush / retryBlocked | migrations,operations,客户端Outbox | cloud-core.cjs; queue-retry.cjs; business-browser.cjs | 保留并接入 |
| 設定 | 测试误生成清理及历史现金关联修复 | 既有管理员审计入口 | cleanTestData / repairFormalDocument / reconcileReceiptCalendarCash / resolveDuplicateCalendarCash | 精确ID、revision、备份及 auditLogs | ledger-cleanup-browser.cjs; historical-duplicate-audit.cjs; firestore-rules.cjs | 保留并接入 |
| 全局 | 租户隔离、员工权限、事务、现金镜像一致性 | 业务服务和数据规则 | CloudCore / Business / AccountingDomain / firestore.rules | 同事务 getAfter / 审计 / version | firestore-rules.cjs; business-browser.cjs | 保留并接入 |
| 全局 | 离线/PWA/旧缓存升级保留数据 | sw.js / APP_SHELL | 原 Outbox + 新样式模块缓存 | 不清空原存储或旧端末队列 | navigation.cjs; receipt-calendar-browser.cjs; queue-retry.cjs | 保留并接入 |

## 审计边界

已比对实际 main、PR #54 的13文件改动、九页附件、业务命令、权限规则和浏览器控件清单。第一阶段已验证替代或明令禁止的旧分支，不因功能对照而恢复。内部迁移、现金回填及同步回调使用既有管理流程，不暴露成可任意操作生产数据的通用命令按钮。

仍须：真实 Google 账户授权与发送现场验证、Windows/真实 iPhone 验收、生产备份来源的隔离恢复、全部按钮/状态人工逐项签核。
