# 入金画面・CSV・無効帳票履歴の整理

基線：main `d06219496cc5b863a872403f8d9e1df8a13feace`（PR #3 合并后）。范围仅限入金確認区块删除、正式 CSV 与页面数据统一、管理员无效帳票历史归档。

## 冲突及重复入口

| 入口 | 问题 | 处理 |
|---|---|---|
| accounting-ui renderPayments / accountingPayments | 原样拼接全部历史 payment，取消与 pending/confirmed 混在同一多余界面 | 删除区块、渲染、状态标签和 accountingVoidPayment |
| accounting-domain voidPayment | 只由旧区块调用的取消命令 | 删除命令及分发类型；保留银行照合解除 |
| accounting-ui exportRows('sales') | 直接导出所有原始 sales/payments，取消和未确认历史进入正式 CSV | 改为每笔有效 sale 一行，与台账共用 currentSales / A.salesRows |
| 未収表格与CSV | 两处分别调用相同计算，容易再出现独立组装路径 | 共用 currentReceivables / A.receivables / A.ledger |
| bizPaid / Home 月次 income / 帳票余额 | 需一致排除重复 ID、无效状态、已删除入金 | 共享有效记录过滤及唯一 ID 投影；同日同额不同 ID 保留 |
| renderDocuments / 两种历史 | 只有安全 system-error 误登録删除，有效正式帳票无归档功能 | 在共同渲染入口增加四种非 live 状态的“履歴から削除”；过滤 deletedAt |

## 保留的共享逻辑

保留 accounting targets/suggestions、pending-bank、bankMatch/bankUnmatch、confirmBank、CSV 解析与银行 ID 规则。这些为银行导入/匹配现用依赖，不属于被删除确认区块。PR #3 的 manualConfirmed 登记路径继续写 bank-confirmed，一次操作写一笔 payment，不增加 pending 镜像。保存領収書、旧迁移等未提及路径保持原有行为。

按 record ID 去重，不以金额、日期、客户等内容猜测重复。正式 CSV 不输出原始历史 payment，而输出有效 sale 及确认入金合计、余额、最终入金日。売上CSV采用当前売上月份，未収CSV采用页面基准日；历史 PDF 的 receivable-only 保留在未収，未混入売上。

## 历史删除安全边界

沿用现有 documents collection、deletedAt/deleteReason、既有带 revision/operation/audit 的事务。archiveDocument 仅更新所选非 live document，snapshot/status/关联 ID 均保持，不写 sales/payments/bank/calendar。不物理删除原始帳票和 auditLogs。Firestore rules 仅允许现有 admin 对 void/duplicate/revised/cancelled document 写归档字段，active/staff/审计删除仍拒绝。

原有 misregistration 的安全条件与物理删除服务不扩展；UI 的 active 状态没有任何删除按钮。旧误登録浏览器测试改用 void 系统误生成记录。新归档与旧孤立误登録物理删除服务用途不同。

## 验证

- 静态/PWA、6项修复/清理、56项业务单元通过。
- Firestore emulator 30项通过，包含四种归档、权限/并发版本、审计不可删除、有效关联记录不变，以及银行 CSV 重复导入/确认/解除。
- 新 ledger-cleanup-browser：真实 Firebase SDK + demo emulator，390/1280px，实际入金表单、同日同额两笔确认、pending/cancelled/duplicate/orphan 排除、实际下载 CSV 解析逐行与页面一致、月份/基准日筛选、四种历史删除、active无按钮、两种列表消失、audit及关联记录保留。
- 现有浏览器回归结果在交付记录中逐项记录；Google 和 PDF 按现有测试使用替身，生产业务数据未写入。

## 发布依赖

历史归档需先部署本次 firestore.rules，再发布前端。规则发布只修改访问校验，不修改生产业务记录，不迁移历史。现有 admin/staff 范围不变。PWA 缓存版本 payment-csv-history-20261008-1。
