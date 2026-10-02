# 正式帳票の番号と登録番号

見積書・請求書・領収書・小野田正式請求書の新規草稿には正式番号を設定しません。正式保存、PDF出力、印刷時に正式保存を完了し、Asia/Tokyo の現在日時から `YYYYMMDD-HHmm-NN` を採番します。請求日・売上日・入金日とは独立しています。同じ会社の全種類で同じ分の連番を共有します（01、02、…、100）。

クラウドでは `companies/{companyId}/operations/documentNumber_{invoiceNo}` を番号の予約として使います。既存の予約を Firestore transaction 内で確認し、最初の空き番号の予約、正式 document snapshot、売上/入金、監査、操作の冪等性マーカーを一括コミットします。既存ルールで operations は作成のみ許可され、更新・削除は禁止です。競合時は transaction を再実行し、予約衝突による permission-denied は予約の存在を確認した場合だけ再試行します。失敗した保存は番号を消費しません。新しいコレクションやルールの追加・デプロイは不要です。

正式保存した番号は snapshot に保持し、再表示・再ダウンロード・印刷・翌日・PWA再開で再採番しません。旧形式の保存済み帳票も元番号を保持します。訂正草稿は番号をクリアし、正式保存時に新番号を取得します。原本 snapshot と番号は保持し、既存の revisedFromDocumentId、saleId、paymentId の関係を引き継ぎます。

オフラインの共有草稿は既存 outbox に保持され、接続回復後の正式コミット時に採番します。正式保存と同期が完了するまではPDF・印刷を開始しません。Firebase を明示的に無効化した旧ローカルモードの採番は端末内だけの互換動作で、端末間の一意性は共有モードで保証します。現在の本番 firebase-config.json は共有モードが有効です。

登録番号は既存の会社設定・適用日条件のまま、帳票右上の No.・発行日・有効期限欄に一度だけ表示します。住所・TEL・MAIL・印章は維持します。

検証: `pnpm test`、`pnpm test:rules`、`pnpm test:browser`、`pnpm test:business-browser`、`pnpm test:document-numbering-browser`、`pnpm test:auth-persistence`。番号用ブラウザテストは独立した390px/1280pxのブラウザ、実際のFirestore emulatorとルールを使用し、同時保存、正式snapshot一致、翌日再ダウンロード、訂正関係、会計件数、四種類の出力版面を確認します。PDFコールバックでは描画ライブラリをテスト用adapterに置換し、実際の出力用HTMLを画像で検証します。認証・Google APIの本番データには書き込みません。

追加検証: `HTML2PDF_BUNDLE` に本番と同じ html2pdf 0.10.1 のローカルbundleパスを指定すると、四種類の実際のPDFを生成し、1ページ・非空・保存番号の不変を確認します。月が変わって再表示した場合も正式snapshotの月を保持します。
