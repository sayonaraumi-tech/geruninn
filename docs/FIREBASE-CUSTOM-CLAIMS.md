# 一次性设置 tsukinowa Custom Claims

脚本：`scripts/set-tsukinowa-claims.cjs`。使用仓库已有的 `firebase-admin` 依赖和 Application Default Credentials (ADC)。不会读取仓库中的私钥，不会创建/删除用户、修改密码、撤销登录会话或写入 Firestore。

固定目标：

| UID | companyId | role |
| --- | --- | --- |
| Du6KeSndv5UKijU10kZgrkRDPQQ2 | tsukinowa | admin |
| sBbSB4IDaPM3BTeWho17kqz1YV82 | tsukinowa | staff |

## 在 Google Cloud Shell 执行

在现有仓库目录下，使用 Node.js 22+：

```sh
git pull --ff-only origin main
npm install --ignore-scripts --package-lock=false
node scripts/set-tsukinowa-claims.cjs YOUR_FIREBASE_PROJECT_ID
```

将 `YOUR_FIREBASE_PROJECT_ID` 替换为实际 Firebase **项目 ID**，不是公司 ID。公司 ID 已固定为 `tsukinowa`，脚本不会猜测目标项目。也可使用 `npm run claims:tsukinowa -- YOUR_FIREBASE_PROJECT_ID`。

脚本调用 `initializeApp({ credential: applicationDefault(), projectId })`。Cloud Shell 的执行身份须有该项目读取和更新 Firebase Authentication 用户的权限。脚本不会自行授予 IAM 权限。

如果 Cloud Shell 当前 ADC 可用，可直接运行。如果 Firebase Auth 拒绝普通 gcloud 用户凭据，可使用有 Firebase Authentication 管理权限的服务账号的**模拟身份 ADC**，无需创建/下载私钥。操作者需已具有模拟该账号所需权限，例如该服务账号上的 Service Account Token Creator：

```sh
gcloud auth application-default login --impersonate-service-account=YOUR_SERVICE_ACCOUNT_EMAIL
node scripts/set-tsukinowa-claims.cjs YOUR_FIREBASE_PROJECT_ID
```

不要把 service account JSON、ADC 文件或访问令牌复制到仓库。若设置了 `GOOGLE_APPLICATION_CREDENTIALS`，它会优先影响 ADC 的选择；使用模拟身份 ADC 时请确保它没有指向另一个凭据文件。

参考：[Firebase Admin SDK 初始化及用户凭据限制](https://firebase.google.com/docs/admin/setup#test_with_gcloud_end_user_credentials)、[ADC 配置](https://cloud.google.com/docs/authentication/set-up-adc-local-dev#sa-impersonation)。

## 验证与重试

脚本先读取两个用户，随后只调用 `setCustomUserClaims` 写入。保留已有的其他 claims，仅将 `companyId` 和 `role` 更新为上述值。两个用户均写入后再次读取，并逐行打印 JSON，例如：

```json
{"uid":"Du6KeSndv5UKijU10kZgrkRDPQQ2","customClaims":{"companyId":"tsukinowa","role":"admin"}}
{"uid":"sBbSB4IDaPM3BTeWho17kqz1YV82","customClaims":{"companyId":"tsukinowa","role":"staff"}}
```

如原来还有其他 claims，输出也会包含它们。日志不包含密码、token 或私钥。不存在某个 UID 或 claims 总大小超限时，在写入前停止。Firebase Auth 不支持跨两个用户的原子写入；若第二次写入失败，脚本仍会尝试读取并打印两个用户的实际状态，以非零状态退出，可修复权限/网络问题后重新运行。请避免同时使用其他工具编辑这两个用户的 claims。

成功后两个用户退出系统再登录，以取得包含新 claims 的令牌。[Firebase claims 生效说明](https://firebase.google.com/docs/auth/admin/custom-claims)

验证脚本本身（不会连接真实 Firebase）：

```sh
node --test tests/set-tsukinowa-claims.cjs
```
