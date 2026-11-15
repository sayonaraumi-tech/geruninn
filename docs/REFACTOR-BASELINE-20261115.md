# 验证环境基线（2026-11-15）

## 环境
- Node: v22.21.1（通过二进制安装到 /opt/node22）
- pnpm: 11.25.0
- 依赖：pnpm install --frozen-lockfile 成功

## 测试结果
| 套件 | 结果 | 备注 |
|------|------|------|
| `pnpm test` | **PASS**（188 tests） | 完整单元/集成套件 |
| `pnpm test:browser` | **FAIL** | Playwright Chromium 已装；`onoda-browser.cjs` 因 `#bizEventModal` 拦截点击超时。可能与 CSS 提取后的加载时序或 headless 环境有关，需进一步确认 |
| `pnpm test:rules` / 其他 emulator 套件 | **未验证** | 本地 Java 17，firebase-tools 要求 Java ≥21。GitHub Actions 使用 Java 21，可在 CI 运行 |
| PDF 完整渲染对比 | **未验证** | 单元测试覆盖部分逻辑；完整 A4 渲染需额外 fixture |

## GitHub Actions
`.github/workflows/release-checks.yml` 已配置 Node 22 + Java 21 + Playwright，可在 PR 上跑 local + emulator 套件。

## 结论
单元测试基线稳定。浏览器与 emulator 套件在当前沙箱受限，已如实标记。后续重构以 `pnpm test` 为门禁，浏览器/emulator 标记为未验证直至 CI 或本地补齐。
