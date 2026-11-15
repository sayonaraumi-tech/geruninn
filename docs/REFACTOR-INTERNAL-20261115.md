# 内部重构记录（2026-11-15）

## 基线
- main SHA: `6674e019731b7fbc490e52e32fed348f7c0b7a6d`
- 分支: `refactor/internal-structure-20261115`
- 静态测试 `tests/static-and-sw.cjs`: PASS
- 部分单元测试 (`outstanding.cjs` / `year-end.cjs` / `cloud-core.cjs`): PASS

## 已完成变更
### 1. index.html CSS 提取（低风险）
- 将全部 6 个 `<style>` 块原样提取到 `styles/main.css`
- 在 `<head>` 中添加 `<link rel="stylesheet" href="./styles/main.css">`
- 内容、顺序、选择器完全一致，无视觉变化
- 提交: `8e73d42`

## 待继续（下一迭代）
- `js/accounting-domain.js` 的 `handle()` 命令调度拆分为独立 handler（保持接口不变）
- `js/business-domain.js` 职责进一步拆分
- 更多内联脚本从 index.html 迁出
- 完整 `pnpm test`、Firestore rules、browser 及 PDF 对比（本环境未完整执行）

## 回退
```bash
git checkout main
# 或
git reset --hard 6674e019731b7fbc490e52e32fed348f7c0b7a6d
```
