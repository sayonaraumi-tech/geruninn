# 帳票命名・入金联动统一版本审计与验收

基线：远端 main `3461c632f6f05da38db14dfe867931a67d7e30de`；PR #3 原提交 `695ccb77a80613d6d40ccf81a128229322b76685`。2026-10-08 提交前重新 fetch 确认两者未变化。本版本沿用 PR #3，与 main 一起审计，只处理命名、入金及相关重复代码。发布方式沿用 README 中的 GitHub Pages。没有更改 Firestore rules/config、迁移生产数据或执行生产入金。

## 冲突、重复路径与处理

| 路径 | main / 原 PR #3 的问题 | 本版本处理 |
|---|---|---|
| `index.html:buildPrintFilename`、`business-ui.buildPrintFilename` | 同名覆盖依赖加载顺序；普通文件名曾被分类下划线格式覆盖 | 删除桥接层覆盖；唯一入口调用 `business-domain.documentFilename`，保留关联請求書内容解析 |
| `business-domain.documentFilename` / `projectCategory` | 多分类字符串不符合首个主营项目规则 | 命名独立选择首个主营项目，过滤费用，施工内容兜底，再用工事；Calendar 多分类元数据保留 |
| `business-domain.onodaFilename` | 原 PR 仍按传入日期命名，月初会成为文件名日期 | 独立按目标月份计算月末，固定 dynast合同会社様＋M月分クロス張替請求書；不改月次金额计算 |
| 共享模式 `selectSaleForPayment` | main 的桥接层把入金跳转至现金領収書并填表 | 删除跳转/自动填表；选择 sale 后打开入金表单 |
| `index.html:addPayment`、`business-ui.addPayment`、`outstanding-ui` submit | 本地、共享、余额窗口分别持有提交逻辑和表单 | 一个 UI submit handler、一个 `registerPayment`；保存帳票窗口移动复用同一个表单，关闭后归位；删除余额 submit 和重复表单 |
| `index.html:bizRegisterEstimatePayment`、桥接层同名函数 | 旧本地代码把入金单独保存在 estimate.payment，还改变受注/Calendar 状态 | 统一只选已正式保存的关联 sale 并进入同一表单；删除桥接重复实现；见積受注和日期设置逻辑保留 |
| 原 PR `manualpay` 内容哈希 | 同 sale/日期/金额/方法/备注永远指向同一个 payment，吞掉真实第二笔 | 删除内容哈希；每次明确操作生成新的 operationId/paymentId，发送前持久化到原 outbox；同操作并发合并 promise，重试复用原 ID |
| `outstanding.view` 与 `accounting.confirmed` | 保存帳票把 pending-bank 计为已入金，売上/Home 不计，显示冲突 | 共用 `Accounting.confirmed`；待照合仍在历史中显示，但不冲减余额；不批量转换历史 payment |
| Home 当月入金 | 原 HTML 另按非 pending 状态求和 | 共享模式使用 `Accounting.monthly` 的确认入金结果，未収使用同一 receivables 结果 |
| 登记后刷新 | 写入后仅等待各 collection 的实时通知，返回时页面可能还未完成刷新 | payment 成功后由现有 sync 统一 reload 最新 collections，一次 hydrate/render；读取失败时保留原操作供安全重试 |
| 已结清操作入口 | 原 PR 已结清保存帳票仍有登记，売上/案件行也有按钮 | 余额>0才提供登记；结清保存帳票保留入金履歴，窗口不再展示表单；売上/案件行隐藏登记按钮 |

保留：正式历史原本、备份及迁移、本地模式、独立領収書、显式关联现金領収書及现金镜像、Calendar现金、Google Calendar、GMO CSV唯一明细及照合机制、見積→受注、正式番号事务、小野田生成/金额/保存逻辑。`estimateFilename` 仅为唯一命名器的兼容别名；未入金残高通知 PDF 仍用原专用规则。receipt/CSV/migration 有各自必要写入，不是第二套手工入金入口。

## 最终行为

- 普通：`YY／M／D 客户名様首个主营项目帳票种类.pdf`；两位年、月日不补零、全角／、様不重复。
- 小野田：8/9/10月分别为31/30/31日；2026年2月28日，2024年2月29日。不改保存日期或生产帳票数据。
- 正式請求書仍生成一个 sale/未収。手工确认到账只创建 payment，附带原有 sale 的 paymentIds/paymentVersion 及审计维护；不创建 document、正式番号、PDF或第二个 sale。
- 保存帳票与売上入口共用表单和 registerPayment。保存帳票上下文带 documentId 并锁定对应 sale。
- 银行到账登记为 bank-confirmed；现金沿用 cash-received 及现金镜像。其他实际到账方法也计入确认入金；CSV业务逻辑保持原样。
- 同一次双击/网络重试不重复；用户同步完成后明确登记第二笔，即使同日同额同方法同备注，也得到新 payment。
- 管理员确认权限保持原 PR 边界；staff不能绕过 service。原 CSV 待确认/照合及显式现金領収書权限保留。

## 验收结果

| 验收 | 结果及证据 |
|---|---|
| 普通見積/請求/領収文件名 | 单元及390/1280px浏览器下载调用断言全部通过；主营项目顺序、费用过滤、様去重、fallback覆盖 |
| 小野田8/9/10/2月及闰年 | 任意月内日期的月末断言通过；原月次浏览器24/25/35行及全部金额回归通过 |
| 正式保存→sale/未収 | 业务单元、正式编号及真实emulator浏览器通过 |
| 任一入口登记仅新增payment | 双击500→真实第二笔500→保存帳票100结清；原document/番号/PDF快照不变，sale不新增 |
| 四页面一次登记同步 | 浏览器直接断言Home当月入金/未収、売上、未収一覧、保存帳票金额自动更新；无额外页面确认 |
| 入金済隐藏登记 | 保存帳票卡片只保留入金履歴，窗口表单归位，売上按钮消失；390/1280px截图验证 |
| 部分入金及两笔同日同额 | 余额1100→600→100→0；域层及真实Firestore emulator两笔真实入金独立存在 |
| 双击/网络重试 | UI按钮与service并发保护；丢失成功响应后outbox重试仍一笔，成功后一次reload；真实emulator同操作重放通过 |
| 既有业务 | 独立银行/现金領収書、现金镜像、CSV重复导入与照合、Google Calendar、見積受注、小野田月次、历史PDF导入通过 |
| 390/1280px | 主要业务、正式编号、保存帳票、历史导入、页面同步通过；原小野田/导航另外覆盖390/1440px |
| 完整测试 | 静态/PWA＋6个小野田/清理测试＋55个业务单元全部通过；Firestore emulator29/29通过；全部现有浏览器入口与auth-persistence通过 |

执行命令：`node --run test`、`node --test tests/firestore-rules.cjs`（demo-tsukinowa emulator）、`node --run test:browser`、`node tests/business-workflow-browser.cjs`、`node tests/estimate-calendar-browser.cjs`、`node tests/business-browser.cjs`、`node tests/document-numbering-browser.cjs`、`node tests/historical-import-browser.cjs`、`node tests/outstanding-browser.cjs`、`node tests/auth-persistence.cjs`、`git diff --check`。

测试仅使用隔离localhost/emulator和测试账号。文件名与“入金不输出PDF”的浏览器断言使用PDF保存替身；另补实际html2pdf渲染库的独立領収書下载回归。真实Google OAuth/银行业务数据未写入；线上烟雾只读取发布资源。UI截图及上线commit/验证证据随交付报告提供。
