# Dependency candidate verification — 2026-11-16

Branch: `security/dependency-refresh-20261116`
Target: `security/operations-read-isolation-20261116`

- Updated development dependencies with a regenerated pnpm lockfile, then patched `@grpc/grpc-js` to 1.13.6 using `pnpm-workspace.yaml` overrides (pnpm v11 ignores package-level overrides).
- Isolated patch workflow: https://github.com/sayonaraumi-tech/geruninn/actions/runs/43824037702
- Production-only dependency audit: **no known vulnerabilities**.
- All dependency audit: **0 high**, **4 moderate**.
- Unit/business checks: 191/191 passing; Firestore emulator: 48/48 passing; other subsidiary suites also passed.
- This does NOT verify full live browser/PDF release regression, deployed cloud permissions, backup restoration, IAM/MFA, or Japanese electronic tax records compliance.
- Candidate is not merged or deployed. Review all major-version upgrades and run full release suite before merge.
