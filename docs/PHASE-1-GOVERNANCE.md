# geruninn 第一阶段治理与 UI 接入

基准提交为 `6674e019731b7fbc490e52e32fed348f7c0b7a6d`。该提交回退了 PR #47 的集成结果，本分支从实际的 `main` 开始。候选代码适用独立 Firestore 模拟器和合成测试数据。

## 模块和依赖

| 场景 | 第二阶段接入点 | 权威数据及现有边界 |
| --- | --- | --- |
| HOME 与期间账台 | `TsukinowaAccounting.periodFilter / aggregate / ledgerRows / settlementExport`，及 `TsukinowaYearEnd.effective` | 由 `sales`、`receivables`、`payments`、`expenses`、银行证据投影。读视图与 CSV 共用会计口径。 |
| 日程与客户 | `TsukinowaBusiness.createService().execute` 的 `calendar`、`calendarPrepareCreate`、`calendarCreated`、`calendarPatched`、`registerCalendarSale` | Google Calendar/ICS 与 `calendarLinks` 对接。客户名称出现在日程、账票和销售快照，目前缺少独立客户主档。关联身份用明确 ID。Google 标题中的「現金」只作为日程信息。 |
| 見積履歴 | `saveDocument`、`acceptEstimate`、`estimateInvoices` | `documents`、`estimates`、`projects`、`calendarLinks`、`sales`。保留受注、无日期安排、关联开票和历史搜索。 |
| 帳票、PDF 及保存帳票 | `TsukinowaBusinessUI.prepareFormalOutput`、`saveDocument`、`documentStatus`、`archiveDocument`、`historicalPdfImport` | `documents` 保存正式快照。继续使用原 A4 渲染、正式编号、原始与改订关联。普通发票、报价、收据和小野田月次使用原有渲染入口。历史导入通过 PDF.js 提取，管理员确认后入库。 |
| 売上、入金、未収 | `payment`、`TsukinowaAccounting.salesRegister / receivables`、`TsukinowaOutstanding` | `sales` 或 `receivables` 加 `payments`。银行待确认与已确认区分，部分入金累计，历史发票与余额通知分离。新现金入金与现金账同事务。 |
| 支出、现金、供应商 | `saveExpense`、`deleteExpense`、`cashAdjustment`、`saveSupplier`、`supplierFromBank`、`settleSupplierInvoice` | `expenses`、`cashLedger`、`suppliers`、`supplierTransactions`。保留现金、代表者立替、法人卡、前渡金与抵扣的既有分类。 |
| 银行照合 | `parseBank`、`bankMatch`、`importBank`、`bankMatch` 命令、`bankUnmatch`、`bankExclude` | `bankTransactions`、`payments`、`expenses`、`settings`。保留账户别名、重复识别、既有 payment 复用、平台净额分配、解除证据、息费分类。 |
| 设置与年末处理 | `TsukinowaCloudCore`、`TsukinowaYearEnd.annual / audit / checks / exports / backup / validateBackup` | Firebase Auth、可信自定义声明、设置、迁移状态、审计、账户范围的缓存和 Outbox。年末备份校验用于预览。 |

页面层为 `index.html` 及 `*-ui.js`。在线写入口经 `TsukinowaSync.createSync` 的 `enqueue/flush/retryBlocked` 及业务服务 `execute`，由 `business-domain.js` 和 `accounting-domain.js` 处理。纯计算继续由 `accounting.js`、`outstanding.js`、`historical-import.js` 和 `year-end.js` 提供。正式 PDF 渲染入口位于 `index.html`，业务服务只提供已确认快照。

数据访问通过 `cloud-core.js` 及 `firebase-driver.js`。持久化记录包括 `payload`、`revision` 和审计引用。以 `operationId` 标识一次用户操作，重试沿用同一 ID 与命令内容。编辑需要原始 `expectedRevision`，失败应显示冲突和后续可用操作。Firestore Rules 在数据层限制租户与角色、校验关联、版本以及审计行。第二阶段从上述接口读取金额、状态和关联结果。

## 本分支修复

- `firestore.rules` 要求新 `cash-received` 记录与同一事务的 `cash_<paymentId>` 匹配，检查金额、日期、关联 ID 和有效状态。员工可读自己的操作和编号占用信息，管理员误生成清理的备份及操作列表受管理员权限保护。
- `business-domain.js` 统一默认入金方法及确认状态，合并读取集合的共同逻辑。银行导入复用同一次入金候选扫描，移除已被业务入口拒绝的历史银行取消、复原的候选读取分支。事务仍按确定 ID 重读引用。
- `cloud-core.js` 隔离关闭或重启前的认证观察者、权限判定和延迟集合读取。
- `index.html` 将保存快照中的数量和单价作为数值输入属性或文本展示，防止打开账票时把异常内容解析为元素或事件属性。保留正常账票的 A4 模板、金额和税额算法。
- `business-sync.js` 拒绝同 ID 异内容的入队。提交成功后的刷新或本地移除失败保留原操作以供幂等重试。旧数据迁移先回读现存备份并核对格式、版本及原始内容。
- `pnpm-workspace.yaml` 和锁文件将管理员工具的传递依赖 `node-forge` 固定到 `1.4.3`。PWA 服务工作线程只更新缓存版本标识。三份既有测试文件补充八个回归用例。

## 发布前待确认

| 优先级 | 边界 |
| --- | --- |
| 高 | 2026-11-17 对生产默认 Firestore 库进行元数据只读核查。东京区域无托管备份计划，托管备份列表为空，PITR 已关闭。独立导出、备份权限和生产来源隔离恢复未验证。模拟器已用合成账票完成导出、恢复和指纹比对。 |
| 高 | 剩余开发与运维依赖通报按实际调用面复核。npm 审计仅涵盖锁文件依赖，浏览器的 CDN 脚本和内置 PDF.js 应独立评估。 |
| 高 | 规则可检查同一事务的锚点和审计，也可验证新增现金镜像。累计入金上限由业务服务和交易内引用重读负责。对直接请求绕过业务服务的全面防护，仍需要云端写入边界或可验证的聚合约束。 |
| 中 | 本地 v2 Outbox 为同一浏览器账号按键保存整列。不同设备的 Firestore 事务并发已测试，同浏览器多标签修改本地队列仍有竞争风险。 |
| 中 | 页面文件仍包括兼容离线与历史数据的保存、显示和导出分支。保留这些入口及动态引用，当前没有独立客户主档或正式服务端 API。 |

生产环境中的已部署规则、历史数据一致性、真实 OAuth、权限清单和原设备的待同步队列尚未现场核查。此 PR 仅用于审查和回归验证。
