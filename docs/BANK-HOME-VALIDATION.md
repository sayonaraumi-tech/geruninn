# 银行照合与主页重构验证记录

基线：main 683350ba224327203f97f33d6d232d5c3fef1f98。提交前已再次获取远程 main，基线未变化。

## 银行最终流程

- 导入仅保存银行证据。GMO 实际金额列和旧列别名兼容；残高、メモ保留，原始摘要不改写。
- 入金按金额完全一致、日期 ±7 天、名称评分。唯一高置信度显示自動一致；多个或弱候选显示候補；无候选显示未一致。评分不自动记账，确认后才提交。
- 确认复用现有仮入金或尚无银行关联的确认入金。没有现存入金才创建实际收款记录，绝不创建売上。使用 relatedPayments、中央事务 write、paymentIds/paymentVersion 和既有 ledger 未収口径。
- 事务内检查剩余未収与既有入金证据；银行明细已照合不可用于第二张账票。确认/解除/重照合均有回归覆盖，并发入金不会重复结清同一应收。
- 出金仅照合现有银行相关支出，包含单笔法人卡消费；现金与代表者立替不自动候选。确认仅关联，不新增费用。
- 未一致出金由用户打开通常支出表单、确认科目/取引先/内容/方法后提交。expenseFromBank 在单一事务中调用既有 saveExpense 和 bankMatch，重复点击/导入受稳定 ID 和关联状态保护。
- 月度卡扣款保持未一致 / カード決済まとめ候補，无强行一对一或拆分。

## 主页最终结构和清理

统一月份/公司年度/自定义范围；六项 KPI；月次収支台帳；支出科目和入金渠道内訳；決算・エクスポート；最多五条异常提醒。未収为期间末存量，包含以前期间未收；収支差額为确认入金减支出，并保留非会计利润提示。

删除 pageMonthly、monthly 导航/路由、monthlyMonth、renderMonthly 包装链、旧月次 KPI、monthlyDetails、旧操作历史重复区、dashSalesRows 和首页最近销售完整明细。更新旧浏览器测试以覆盖主页新入口。管理者手机可从导航进入主页，员工权限不变。年度明细不再重复在页面渲染，原年度资料/备份/审计输出保留在折叠区域。

periodFilter、aggregate、ledgerRows、bankMatchScore/bankMatch、settlementExport 统一口径。monthly 与年度报表复用 aggregate，银行明细和现金镜像不重复计入売上/费用/入金。

## 验证结果

| 检查 | 结果 |
|---|---|
| pnpm test | 136/136（6 + 130），含新增银行/主页 domain 测试 |
| pnpm test:rules | 36/36，原 Firestore Rules，本地 demo-tsukinowa |
| pnpm test:browser | 全部通过，含导航、PWA升级、Cloud、Calendar替身、receipt |
| 银行/会计浏览器回归 | expense-bank-browser.cjs + business-browser.cjs 在真实本地模拟器通过 |
| pnpm test:business-workflow | 19/19 domain + 390px/1280px 浏览器通过 |
| pnpm test:estimate-calendar | 4/4 domain + 双尺寸浏览器通过 |
| pnpm test:home-ledger-browser | 双尺寸默认月/月切换/年度/自定义/KPI/台账/导出/无页面溢出通过 |
| GMO 原始文件 | 31 行，Shift_JIS；逐行金额、摘要、残高、メモ、重复解析稳定 ID 通过 |
| git diff --check | 通过 |
| Firestore Rules 差异 | 无 |

GMO 原件 SHA-256：a49e1f94fb46d530368671f2c60c6ac9d5a7aee262651f3a705589e64ec55440。原始银行内容未提交。

所有测试使用本地模拟器或内存替身，Calendar 请求被拦截。未执行部署、合并、生产迁移或生产 Firestore 写入。

## 修改文件

业务/界面：index.html、js/accounting.js、js/accounting-domain.js、js/accounting-ui.js、js/business-domain.js、js/year-end.js、js/year-end-ui.js、sw.js。

测试/工具：package.json、scripts/verify-gmo-csv.cjs、tests/bank-home-ledger.cjs、tests/home-ledger-browser.cjs、tests/expense-bank.cjs、tests/expense-bank-browser.cjs、tests/firestore-rules.cjs、tests/business-browser.cjs、tests/calendar-sync.cjs、tests/estimate-calendar-browser.cjs、tests/in-browser.js、tests/navigation.cjs、tests/onoda-browser.cjs。

文档：docs/EXPENSE-BANK-WORKFLOW.md、docs/YEAR-END.md、docs/BANK-HOME-VALIDATION.md。
