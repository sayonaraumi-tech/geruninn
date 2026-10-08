# 帳票命名与入金解耦审计／验收

基线：main `3461c632f6f05da38db14dfe867931a67d7e30de`（提交前重新核对远端 main）。只提交评审分支，不部署、合并，也不修改生产 Firestore。

## 历史对比与冲突／残留

| 路径 | 历史／当前冲突 | 处理 |
|---|---|---|
| `index.html:buildPrintFilename` → `business-domain.documentFilename` | `b49e944` 以前的实现使用 YY／M／D、空格、客户様、首项、小野田 M月分；`b49e944` 对見積采用分类下划线命名，`7a94200` 将下划线命名推广到所有帳票 | 恢复实际业务格式；补上费用项过滤、様去重及施工内容兜底 |
| `business-ui.buildPrintFilename` | 覆盖 HTML 中同名函数，再额外解析关联請求書；入口依赖加载顺序 | 删除覆盖定义；关联原請求书解析移到唯一 HTML 入口 |
| `projectCategory` | 将多个项目汇总为分类字符串，用作文件名会拼成长串；小野田也被普通规则覆盖 | 文件名专用首项目选择；普通一套，小野田固定一套。保留分类函数供现有日历／业务元数据使用 |
| 共享模式 `selectSaleForPayment` | 原 HTML 已有入金表单选中行为；共享桥接却调用 `setDocType('receipt')`、切换帳票页并填写现金領収书 | 删除这段領収书跳转／填表调用链，复用原入金表单入口 |
| 主入金表单及保存帳票余额弹窗 | 两处各自随机生成 payment 并入队；銀行振込一律变成 pending-bank | 合并为 `registerPayment`；用户核实到账的銀行振込沿用 bank-confirmed |
| 手工入金重复提交 | 操作 ID 可防同一命令重试，但不同页面／设备重新提交会生成新 payment ID | 使用现有 stable ID／事务机制，同 sale、日期、金额、方法、备注生成同一 payment ID；保留队列和忙碌保护 |

没有发现可以证明完全无引用且与迁移无关的额外会计 helper，因此没有继续扩大删除范围。以下仍有用途，保留：端末内模式和备份／历史迁移、独立領収书 `saveDocument`、现金領収记账和补齐、見積受注、Calendar、CSV银行照合、权限和未収计算。`estimateFilename` 是兼容别名，仅调用唯一命名器，不再形成另一套算法。未入金残高通知是独立通知文档，未改它的专用命名。

## 最终行为

- 普通：`26／4／8 中村成男様クロス張替領収書.pdf`、`26／9／24 蛍火株式会社様網戸張替請求書.pdf`。
- 小野田：`26／8／31 dynast合同会社様8月分クロス張替請求書.pdf`。独立固定客户、项目及日期月份；原月次金额／生成逻辑不变。
- 主营项目按项目出现顺序识别，费用项不参与；没有已识别主营项目则取首个非费用施工内容，再兜底“工事”。Calendar 仍保留原多分类元数据。
- 売上・入金 → 入金：选中 sale、填写日期／方法／金额／备注 → 入金登録。共享模式只执行 payment 命令及现有 sale.paymentIds/paymentVersion、审计更新；銀行振込为 bank-confirmed。没有 document 保存、正式编号预留、PDF 或領収书调用。
- 确认到账沿用现有管理员权限边界；未扩大 staff 权限，也未修改 Firestore rules。
- 相同 sale、日期、金额、方法、备注的再次提交视为同一入金；部分／后续入金通过不同金额、日期或备注区分。取消済 payment 不会被自动复活。
- 未改变 CSV银行照合路径；历史 pending-bank 记录不批量转换。独立帳票模块创建領収书仍保留原记账规则。

## 修改文件

生产代码仅四个文件：`index.html`、`js/business-domain.js`、`js/business-ui.js`、`js/outstanding-ui.js`。

回归：`tests/business-workflow.cjs`、`tests/business-workflow-browser.cjs`、`tests/estimate-calendar.cjs`、`tests/estimate-calendar-browser.cjs`、`tests/firestore-rules.cjs`；以及本审计记录。

## 验收

| 要求 | 证据 |
|---|---|
| 1–4 四类文件名 | 单元断言及桌面／手机浏览器 PDF 保存调用的完整文件名断言 |
| 5 首个主营项目、忽略费用、施工内容兜底 | 多项、逆序、同一行多项目、材料费／出张费／杂费、全费用测试 |
| 6 様去重 | 蛍火株式会社様准确文件名断言 |
| 7 入金仅更新 payment、未収部分／结清 | 实际点击 sale 行入金按钮，主表单登记 500，余额弹窗登记 600；未収 1100→600→0；documents、documentNumber 操作与 PDF 次数保持不变 |
| 8 防重复 | 同时提交、同步后重复提交、不同 payment ID／operation ID 的域层并发与重试，始终只有一笔 payment |
| 9 独立領収书 | 原 standalone-receipt 单元测试及两种屏宽下独立正式領収书创建、原本打开／再下载 |
| 10 小野田月次 | 原 onoda 单元及浏览器月次回归，24／25／35 行、金额合计、重复／取消／删除数据处理、多页 PDF 调用、保存／revision |

执行结果：

- `node --run test`：静态/PWA检查通过；6 个 onoda/cleanup 测试和 52 个业务单元测试全部通过。
- `node tests/business-workflow-browser.cjs`：390px、1280px 全部通过。
- `node tests/estimate-calendar-browser.cjs`：390px、1280px 全部通过。
- `node tests/onoda-browser.cjs`：390px、1440px 全部通过。
- Firestore demo 模拟器 `node --test tests/firestore-rules.cjs`：28/28 通过，包括新确认入金、编号不变、重复提交及 staff 拒绝。
- `git diff --check`：通过。

浏览器以隔离数据和 PDF 保存替身检验下载调用／文件名，不连接生产；未重新设计或修改 PDF 页面布局。本次未对真实银行流水或生产账票执行验收操作。
