# 历史重复记录：只读核对与逐项审批流程

## 已核实的范围

2026-11-02 日本时间：main `9aa63a2901caa10780ca37664ac807803d44b181`；PR #18 head `616e38550d26c55936e53f9718ad716f106e5e21`，open/draft，未合并。生产配置指向 `tsukinowa-business`，租户 `companies/tsukinowa`。本次未取得生产读取结果；本机没有已配置的 GOOGLE_APPLICATION_CREDENTIALS 或默认 gcloud ADC 文件，连接工具也没有 Firestore 读取能力。Firebase 网页配置中的 API key 不是读取授权。未尝试匿名读取或获取用户密码。

## 实际结构与正常关联

业务文档使用 `{revision, payload, ...metadata}` 封装。审计保留原封装、Firestore 文档 ID、updateTime 与内容摘要；路径中的 ID 为依据。

| 起点 | 引用 | 核对原则 |
| --- | --- | --- |
| sales / receivables | paymentIds、documentId、calendarEventId | sales 与 payments 同时存在、HOME 合一行正常，不能删其中一张来消除显示重复 |
| payments | saleId（可指向 sales 或 receivables）、bankTxnId / bankId、documentId | 分次收款、跨期付款合法；同一银行证据多次确认才是重点候选 |
| bankTransactions | matchType / matchId、paymentId、expenseIds | 照合记录必须与付款/费用双向一致；利息无需 sale/payment |
| expenses | bankTxnId、supplierTransactionId | 借记卡费用和银行出金是两层证据；信用卡多费用对应一次结算合法 |
| documents | saleId、receivableId、paymentId、snapshot 中引用、改订链 | 正式帳票及快照必须保留；不能凭同额、同客户去重 |
| cashLedger / auditLogs / operations | 现金镜像、历史操作与审计 | 取消会影响现金余额、审计、幂等键，必须一并核对 |

源码依据：js/cloud-core.js、js/accounting.js、js/accounting-domain.js、js/business-domain.js、firestore.rules。main 与 PR 的变更范围可由 `git diff origin/main 616e385 -- js/accounting.js js/accounting-domain.js js/business-domain.js` 复核。PR 中 bankExclude 是排除银行记录，不等于撤销相关 payment 或 expense；deleteExpense 拒绝已银行照合或供应商关联费用。不能将这两个入口当成通用清理器。

## 只读工具

1. 由获授权操作员在可信环境使用只读 IAM 身份（例如仅 Firestore 读取权限），按锁定版本安装仓库依赖。不要提交密钥、快照或报表到 GitHub。不要运行设置 claims 的脚本。
2. 执行 `node scripts/export-historical-audit.cjs tsukinowa-business tsukinowa PRIVATE_SNAPSHOT.json`。收集器只有读取，在一个 readOnly 事务中读取固定租户的全部指定集合；任一集合失败整体报错，不生成完整结果。大数据导致事务超时则停止，不能把残缺分页当完整快照。不能用本工具声称已完成原生备份。
3. 保留原始快照不变。另建审查副本，可增加顶层 `reviewedAccountIds` 映射，将各 bankAccount 标签对应到经银行凭证核实的真实账户 ID。工具不会把两个显示名称擅自当作同一账户。记录映射审批人、时间和凭证存放位置。
4. 执行 `node scripts/historical-duplicate-audit.cjs PRIVATE_REVIEW_COPY.json NEW_PRIVATE_REPORT.json`。输出每组记录原 payload、revision、SHA256、关联 ID、断链、各笔金额；KPI 差额未知时为 null，绝不填 0。输出文件不覆盖。此 JSON 是逐项审查表，approvedActions 永远为空。

编号相同的银行候选仍要检查日期、原始摘要、入出金额、余额及 occurrence 是否冲突。没有流水编号时，余额和 occurrence 一致也必须比对完整原始 CSV、导入范围、余额链；重叠 CSV 的 occurrence 可能不同或碰撞。账户不同、流水号不同、余额不同、occurrence 不同都可能代表真实不同交易，不能按金额推翻证据。同额候选仅供查找，永不授权删除。

本工具输出显式已知关联和完整原 payload；自定义字段、sourceId 多态关联、外部 Calendar、Storage 附件与全部审计内容仍须人工核对，不能把 edges 当成所有可能引用的证明。JSON 序列化时间、引用等 SDK 特殊类型后不能保证无损恢复。

## 逐项批准模板（目前没有可批准的真实记录）

| 项目 | 必须填写 |
| --- | --- |
| 审查编号 | report reviewId、来源快照 SHA256、代码版本、读取时间 |
| 保留与拟取消 | 完整 Firestore 路径；不可只填显示名或金额 |
| 强证据 | 真实账户 ID 及核实来源、流水号、日期、原始摘要、入出金额、余额、occurrence、原始 CSV 行与导入范围 |
| 关联 | 所有正反向引用、正式帳票/改订链、现金镜像、供应商台账、Calendar、审计与幂等操作 |
| 冲突 | 多笔已照合、编号相同内容不同、分次/合计收款、跨期、退款、卡结算、断链等逐项结论 |
| 影响金额 | 每笔原始金额；按实际应用共用逻辑计算前后收支、未收、现金、月度/年度 KPI 和 CSV，不能将候选金额直接相加为损失 |
| 备份 | 原生 Firestore 备份/导出位置、时间、校验、附件保全、隔离恢复验证结果 |
| 执行与恢复 | 预期 revision/updateTime、逐字段前后值、操作者、原因、事务边界、审计记录、幂等标识、恢复步骤与演练结果 |
| 用户批准 | 明确批准的路径及动作；本次只读授权不等于取消批准 |

## 经批准后的方案设计约束（本 PR 无执行器）

先在隔离模拟器或隔离项目恢复备份，逐项演练。纯银行别名重复且未照合的候选，优先考虑带原因、duplicateOf 与审计的逻辑排除；保留所有原始证据。若多个候选已照合，必须核实其 payment/expense 是否重复；禁止只隐藏银行行而留下双重记账。重复 payment、sale、expense 必须按正式业务撤销流程设计独立方案，重建受影响引用及现金镜像。正式帳票不物理删除；需要更正时保留原件与改订链。

执行器若后续开发，只允许明确获批的单项计划，事务内重读所有涉及记录并检查 revision/updateTime、金额和引用；任一变化即中止重审。不使用本审计工具生成的候选组自动挑选保留记录。不硬删除、不批量清理、不运行登录触发迁移。

恢复需核对原生导出在隔离项目中能还原类型及文档关系。单项撤销回滚也须检查修复后的 revision，防止覆盖后续合法交易，保留原审计并新增恢复审计。Firestore 原生导出并不自动覆盖外部附件、Calendar 或完整账户配置，分别保全。恢复后重跑 HOME、收支、现金、未收、KPI、CSV 与正式帳票比对。

## 当前结论

尚无正式数据快照，无法提供真实重复数量、关联 ID、可取消清单或确认影响金额。当前批准清单为空。这表示尚未核实，不表示没有重复。PR 不自动合并或部署；生产数据未更改。
