# 全站视觉统一回归记录

基线：main `4b4b48ffae88f727b73941eebf3db36d74b0a1c0`（PR #28 合并后）。仅修改 index.html 的样式及测试；没有修改业务 JavaScript、Firestore 规则、数据、同步队列、Calendar 或正式 PDF 模板。

以「見積履歴」现有字体栈、13px 表格正文、11px 表头、700 表头字重、10px 9px 单元格间距为共用标准。保留黑金导航、浅灰底、白色圆角卡片、金额对齐及表格横向滚动。

| 同一测试数据 / 1280px | 修改前 | 修改后 |
| --- | --- | --- |
| 売上台帳正文 | 13px | 13px（与見積履歴一致） |
| 单元格间距 | 14px 10px | 10px 9px |
| 含操作按钮的第一行高度 | 70px | 62px |
| 表格最小宽度 | 1420px | 1180px |
| 筛选输入字体 | 浏览器默认 | 继承共用字体，13px |

行高由内容和操作按钮决定，不用固定高度截断业务内容。手机筛选区按两列流动，宽表在自身容器内滚动。

清理范围：删除销售表格独立的容器、表头、单元格及筛选输入覆盖；删除 HOME/银行独立字体栈、HOME 重复字号及表格上下间距。保留仍使用的金额、状态颜色、银行展开详情及手机卡片布局。未因静态搜索缺少引用而删除业务代码或动态选择器。

验证结果：

- 单元及静态检查：179/179 通过，0 失败。
- Firestore 实际规则模拟器：45/45 通过；8 组模拟器浏览器套件通过，进程退出码 0。
- 本地完整发布浏览器套件：13 组通过。覆盖导航、正式帳票/PDF、Google Calendar 请求、未収、四条入金路径、现金、银行照合、前渡金、CSV、历史只读、防重复、离线队列、登录持久化；现有套件包含 320/390/768/1280/1920px。
- 新增全站视觉检查：九页 390/1280px 全部通过，比较实际 computed style、表头/输入尺寸、无页面横向溢出、导航避让及测试记录不变；云账户弹窗打开/关闭通过。
- 真实 CSV 下载、期间/年度/基准日、排序及明细开关：390/1280px 通过。

截图来自本地测试数据，不连接生产数据；外部 Google 请求由测试替身验证，Firestore 使用 demo-tsukinowa。桌面/手机均为 Chromium 响应式视口；未声称实机 Safari 验证。

| | 修改前 | 修改后 |
| --- | --- | --- |
| 桌面 1280px | [截图](visual-baseline/sales-before-desktop.png) | [截图](visual-baseline/sales-after-desktop.png) |
| 手机 390px | [截图](visual-baseline/sales-before-mobile.png) | [截图](visual-baseline/sales-after-mobile.png) |

复现：`pnpm test`、`pnpm test:release:local`、`pnpm test:release:emulator`。设置 PREVIEW_DIR 后运行 `node tests/sales-period-browser.cjs`，保存九页和弹窗截图及样式测量 JSON。

本次仅提交 PR 供审查，不合并、不部署。
