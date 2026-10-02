# 過去帳票PDF取込

「保存帳票」の検索欄横に管理者専用の「過去帳票PDF取込」を追加しました。既に正式発行した請求書を補録する機能で、新しい請求書の発行経路・採番・税計算・Calendar更新は呼びません。

## 確認してから補録

20MB以下のPDFを端末内のPDF.js 4.10.38で読みます（本体・workerを固定版で同梱、Apache-2.0）。ファイル内容を外部解析サービスに送信しません。テキストから顧客名、No.、発行日、支払期限、請求額、対象月を候補として表示します。明細は明示的にラベル付きで確実に読めた行のみ参考として保持し、合計・消費税は計算しません。

画像・スキャンPDF、暗号化PDF、未知のレイアウト、解析エラーは手入力に切り替えます。OCRは行いません。すべての自動読み取り値を原本と照合・補正し、重複と関連売上を確認してから「原PDFとの照合を確認して補録」を押します。選択・解析だけでは書き込みません。

- 原invoiceNo、issueDate / invoiceDate、dueDate、invoiceAmount / amountを保持し、有効（active）で保存します。新番号の採番はありません。
- 既存売上が顧客・発行日・金額で一致する場合、その売上を関連付けます。売上の日付・金額・税・入金は変更しません。番号だけ一致して金額等が違う場合や複数売上が該当する場合は停止します。
- 既存売上がない場合、標準Aは帳票のみです。**salesは作成せず**、入金管理用のreceivablesを1件作成します。
- Bのチェックを管理者が明示選択した時だけ、歴史売上を1件作成します。この売上日は原発行日です。既存売上がある場合Bは選択できません。

原PDFのバイナリはクラウドにもブラウザ保存領域にも保管しません。ファイル名・SHA-256・取込日時・sourceTypeを関連付けます。原ファイルは別途保管してください。「取込原本情報」で確認できます。補録帳票を生成テンプレートで再ダウンロード・訂正再発行する機能は設けず、原PDFの内容は変更しません。既存の通常帳票の訂正機能は継続します。補録帳票の無効・重複指定は既存の入金保護付き管理操作を使用します。

## データ・重複・監査

新collection: `companies/{companyId}/receivables`。売上を追加せずに未収を管理する関連レコードです。共通schemaVersion 2のenvelope、id=`receivable_{documentId}`、receivableOnly=true、paymentIds/paymentVersionを使用します。既存売上に関連付けた場合及びBでは作成しません。

`documents.payload`にsourceType=historicalPdfImport、sourceFileName、sourceHash、importedAt、whetherCreatedSale、原invoiceNo / issueDate / dueDate / invoiceAmount、saleId（既存/B）又はreceivableId（A）を追加します。snapshotも原番号・日付・金額を保持します。

最新documentsとsalesをサーバーから取得し、番号一致、PDF hash一致、顧客名+発行日+金額一致を確認します。該当帳票があればIDを表示して停止します。無効・旧版も含めて重複確認します。取込は番号・hash・顧客日付金額のhashキーを既存operationsに原子的に予約し、同時端末・再試行・二重クリックでも1件のみです。使用可能な旧番号は既存documentNumber予約領域にも予約し、通常採番との衝突を防ぎます。既存売上のrevisionをtransaction内で再確認します。

auditLogsには通常のuserId、server timestamp、before/after、operationIdとともにaction=historicalPdfImport、documentId、invoiceNo、sourceFileName、sourceHash、linkedSaleId、whetherCreatedSaleを記録します。関連売上/未収の更新にも既存監査を記録します。

## 入金・会計

既存paymentsを唯一の入金データソースとして使用します。Aのpayments.saleIdはreceivableId、既存/Bのpayments.saleIdはsaleIdです。入金と関連paymentIds/paymentVersionを同じtransactionで更新します。保存帳票の入金登録・入金履歴・未入金残高請求書をそのまま利用できます。

銀行振込はpending-bank、銀行CSV照合は元のpaymentをbank-confirmedに更新します。現金入金は既存cashLedgerミラーを利用します。staffは既存どおり入金登録可能ですが歴史取込及び銀行確認は不可です。未収画面・照合候補・月末未収・年度未収・バックアップにAの未収も含めます。月次/年度の売上及び売上CSVはreceivableOnlyを除きます。確認済入金は既存ルールどおり実際の入金として集計します。

779,379円に770,379円の入金登録で残高9,000円・一部入金となります。残高通知PDFは読み取り専用で、元帳票・sales・税額・operationsを追加/変更しません。

## デプロイ・互換性

データmigration・index追加は不要です。既存帳票・sales・paymentsを一括更新しません。従来schemaVersion 4のバックアップにreceivablesがない場合は空として検証できます。

**本機能を使う前に、新しいfirestore.rulesをproductionへデプロイする必要があります。** GitHub Pagesの公開だけでは権限ルールは更新されません。既存Firebase認証を持つ環境で、リポジトリのmainを取得して以下を実行します。

```sh
pnpm exec firebase deploy --only firestore:rules --project tsukinowa-business
```

又はFirebase ConsoleのFirestore Database → Rulesでmainのfirestore.rulesを公開します。ルール公開後にWeb/PWAを再読込してください。旧ルール環境で新しいreceivablesのreadが拒否されても、従来collectionの同期は継続します。取込開始時には新collectionの権限を検証し、未デプロイなら書き込み前に停止します。

## 検証

`pnpm test`、`pnpm test:rules`、`pnpm test:historical-browser`と既存browser/business/document-numbering/outstandingテストを使用します。歴史テストはdynast例と同じ番号・日付・金額の合成UnicodeテキストPDFを実際のPDF.jsで読み、390px/1280pxのUIとFirestore emulatorで確認します。画像相当のテキストなしPDFと壊れたPDFも手入力で取り込めます。参照会話から原PDFファイルは取得できなかったため、実際のユーザー原本の解析は未検証です。本番帳票・売上・入金はテストで作成しません。
