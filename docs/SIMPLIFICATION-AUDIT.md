# geruninn 简化重构审计与验收

基线：main `6dade741be6399b713ebf267cc0c6e5abea642fd`（2026-10-08）。
范围仅为案件 UI、入金経路、仕入先独立台账 UI，以及相关无引用代码。未连接或改写生产 Firestore 数据。

## 依赖审计

| 对象 | 审计结论 | 处理 |
|---|---|---|
| 案件导航、pageProjects、projectSearch、projectRows、renderProjects | 只展示 projects，并调用已有受注、請求書、入金功能；不是创建或同步入口的唯一来源 | 删除导航、HTML、搜索与渲染调用 |
| projects / projectId / estimateId | 受注关联、施工日、帳票快照、销售关联、Google 反向回写仍使用 | 全部保留 |
| calendarLinks / googleEventId / calendarEventId | 确定性 ID、Google POST/PATCH、409 恢复、ETag 重试、反向日期/时间/地点同步仍使用 | 全部保留；不改同步规则 |
| supplier 独立导航、录入、渲染与编辑状态 | 不被支出/银行/决算依赖；已有模块以 collection 数据读取为边界 | 删除独立页面与录入/订正操作 |
| suppliers / supplierTransactions / supplierBalance / monthly() | 月次材料請求生成材料费；前払/支払参与现金账、银行出金照合、月次与年度导出 | 保留模型、业务命令、历史读取及导出，不迁移 |
| payment.method / memo / confirmation / bankTxnId | method 是现有入金入口；确认状态才决定现金/银行计入与未収；银行照合保留实际银行来源 | method 复用为渠道；可选 platformName，仅新平台记录保存 |
| 历史 オンライン決済、GMO銀行、くらし/暮らしのマーケット | 旧值仍可能在历史记录或未同步命令中存在 | 读取时统一显示，保留旧命令兼容，不改历史值 |

## 删除与合并清单

- 案件导航和页面、专用搜索/表格、renderProjects 及刷新引用。
- 合并两份重复 bizSwitchPage：保留一个路由映射和原有日程月份检查；删除未使用的 _oldBizSwitchPageV5。
- 仕入先动态导航、pageSuppliers、期首残高/交易录入/订正 UI、renderSuppliers。
- 删除 accountingSaveSupplier、accountingEditSupplier、accountingSaveSupplierTransaction、accountingEditSupplierTransaction、accountingDeleteSupplierTransaction，以及 supplierEdit、transactionEdit、旧标签、旧导航包装和无意义的 supplierRows 渲染前置条件。
- 入金経路读取与分组统一使用 paymentChannel / paymentChannels，月次、年度、付款历史、CSV 共用。
- 不删除共用 supplier domain、现金镜像、银行匹配候选、取消/审计及历史导出。

## 最终行为

- 頂部无「案件」和「仕入先」；见积受注与施工日操作仍在見積履歴。
- 入金只选一次「入金経路」：銀行振込 / 現金 / プラットフォーム経由 / その他。
- 平台名仅在选择平台时显示，且可留空；くらしのマーケット可识别为平台明细。
- 月次内訳和年度汇总列出渠道及平台金额；入金 CSV、売上・入金 CSV、月次 CSV、年度 CSV 带出相应信息。
- 已有未収 CSV、PDF 命名、保存帳票、无效历史删除、小野田、Google 规则、CSV 匹配规则、支出金额和权限范围未改。
- 银行照合仍按原规则检查金额/状态；仅对平台仮入金保留原 method 和 platformName，普通入金仍使用原银行文案，bankAccount / bankTxnId 与确认流程不变。
- 月次・決算保留「仕入先照合（準備中）」及历史 CSV 导出。尚无完整 PDF 請求書关联数据，未实现自动供应商差额计算，也没有增加第二套支出录入。

## 修改文件

应用：index.html、js/accounting.js、js/accounting-ui.js、js/accounting-domain.js、js/business-domain.js、js/outstanding-ui.js、js/year-end.js、js/year-end-ui.js、sw.js。
测试：tests/business-workflow.cjs、tests/firestore-rules.cjs、tests/estimate-calendar-browser.cjs、tests/navigation.cjs、tests/business-browser.cjs、tests/onoda-browser.cjs。
文档：docs/SIMPLIFICATION-AUDIT.md。

## 验证结果

- pnpm test：64 项单元测试通过（6 + 58），另静态语法/PWA/存储保留检查通过。
- pnpm test:rules：隔离 demo-tsukinowa Firestore emulator，31 项通过，包括新平台字段、admin/staff 边界与历史 supplier 会计路径。
- pnpm test:browser：小野田、导航、Google Calendar 与云账户浏览器回归全部通过；导航覆盖 390px/1280px、admin/staff、延迟 Google 加载和 PWA 更新。
- node tests/estimate-calendar-browser.cjs：390px/1280px，受注/日期设置、Google POST/PATCH/409 恢复、日期/时间/地点反向同步、单 project/event、平台实际表单保存/历史/月次/CSV 通过。
- node tests/business-workflow-browser.cjs：390px/1280px，确认入金、部分/最终入金、重复点击、真实同金额第二笔、帳票/PDF 无多余写入通过。
- 同一隔离 emulator 下 business-browser、outstanding-browser、historical-import-browser、ledger-cleanup-browser、document-numbering-browser 全部通过：支出/现金、银行重复 CSV/照合、历史 supplier 数据保留、6 类 BOM CSV、部分入金、历史 PDF、无效历史删除、编号与 PDF。
- 人工检查 390px 平台表单和 1280px 简化导航截图。

测试调整说明：旧 business-browser 仍操作已删除仕入先表单，改用隔离历史 fixture 验证读取/集计/导出；受注两端同步等待不足的超时在未修改 main 也复现，已补等桌面受注状态后再生成請求書。未为此修改应用业务规则。

Google 测试使用本地模拟 API，不涉及真实 OAuth 或生产日历写入。Firestore 测试仅使用 demo emulator。

## 上线状态

已准备代码与 PR，未合并 main、未部署、未改生产规则或业务数据。PWA cache 版本已更新，供后续批准上线使用。
