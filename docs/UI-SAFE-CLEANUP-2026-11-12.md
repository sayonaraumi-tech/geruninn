# UI安全清理记录（2026-11-12）

## 本次确认并清理

- `css/desktop-nine-pages.css` 中的 `#pageChohyo.biz-page { background: transparent; }`：静态根元素是 `<div class="editor app-page" id="pageChohyo">`，没有 `biz-page` 类。该选择器要求**同一个根元素**同时满足 `#pageChohyo` 和 `.biz-page`，所以在现有页面结构下不匹配；删除这条独立规则，不改其他页面的样式。

## 暂不清理（缺乏无引用证明）

- `index.html` 的历史内联CSS：级联顺序、动态DOM、移动端和打印规则均可能依赖。
- `css/desktop-nine-pages.css` 里重复出现的九页选择器：虽冗长，但直接合并/改变特异性可能改变样式优先级。
- `css/mobile-three-pages.css` 的响应式规则：390px/360px下布局有明确用途。
- `#pageChohyo` 编辑器、`.invoice`、`.invoice-wrapper`、`#previewArea` 和 `@media print`：PDF/打印保护区。
- 任何JS、Firestore、正式帳票/考勤/工资导出代码：本次未证明无引用，不删除。

## 验证与上线门槛

- 此PR仅删除一条无匹配的CSS规则，不修改HTML、JS、业务状态或数据。
- 仍需CI回归、桌面九页与390px手机三页的视觉核对、PDF打印对照；这些通过前不能宣布完整清理结束。
- PR #39/#40/#41仍为叠加分支；本PR以PR #41为基线，不合并或部署。
