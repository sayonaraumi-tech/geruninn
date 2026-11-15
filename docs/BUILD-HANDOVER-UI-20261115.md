# Grok Build 交接说明 — 电脑端 9 页 UI 重新设计

## 基线
- 仓库：`sayonaraumi-tech/geruninn`
- 分支：`refactor/internal-structure-20261115`
- 基线 SHA：c4e29aaddeaef16af8f933d4a08960622e0942d7
- 状态：内部重构进行中；local CI 通过；Emulator CI 有已知失败项（见风险）

## 设计范围
仅重新设计电脑端 9 页的视觉与布局。  
**不得**改变：
- 任何业务逻辑、财务计算结果、PDF 模板、自动编号
- Firestore 字段与历史数据兼容
- 现有功能入口与操作流程

## 必须保留的功能清单
详见 `docs/UI-PAGE-AUDIT-20261115.md`。摘要：

| 页 | 关键保留项 |
|----|------------|
| HOME | 期间 KPI、CSV 导出、备份 |
| 日程 | Google 同步、帳票关联、小野田再生成 |
| 見積履歴 | 列表、搜索、转换为請求/領収 |
| 帳票 | 四类型切换、**請求書値引き**、预览/PDF/保存 |
| 保存帳票 | 重新打开、再次下载（不重复入账） |
| 売上・入金 | 台账、入金登记、未収 |
| 支出・現金 | 支出登记、现金调整 |
| 銀行照合 | CSV 导入、去重、照合 |
| 設定 | 登录、同步、备份 |

## PDF 约束
- 原版式、Logo、印章、编号规则不变。
- 値引き仅在請求書且 >0 时显示「値引き −N円」，税前扣除后重算消费税。

## 数据结构与接口
- 业务入口：`js/business-domain.js`（`total()` 已支持 `discountAmount`）
- 命令入口：`js/accounting-domain.js`（`handle()`）
- 表单状态：`collectFormState()` / `applyFormState()`
- 云端：Firebase Firestore，事务 + revision

## 已知风险 / 未验证
- Emulator CI：`document-numbering-browser` 的 `topExpiryLine` 显示断言失败。local CI 通过。本地无 Java 21，无法完整复现。已回退无效显示补丁。
- 完整 PDF 像素级对比未在本阶段完成。

## 验收标准（UI 重设计后）
- 9 页全部功能可操作
- 财务结果与重构前一致
- PDF 输出与原版一致（无折扣时）或仅增加値引き行（有折扣时）
- 无正式数据修改

## 下一步
用户验收本阶段后，手动切换至 Build 模式进行 UI 设计。  
本阶段不修改页面视觉。
