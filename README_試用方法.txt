月輪合同会社 業務連動システム PWA試用版

【Macでまず確認】
1. このフォルダを展開します。
2. 「Macで起動.command」をダブルクリックします。
3. Chrome / Safari で http://localhost:8080 を開きます。
4. Chrome系ブラウザでは「Appに追加」からインストールを試せます。

【iPhoneでPWAとして試す】
iPhoneへの正式なホーム画面インストールは HTTPS で公開したURLが必要です。
index.html / manifest.webmanifest / sw.js / icons フォルダをそのまま HTTPS サーバーに置いてください。
SafariでそのURLを開き、共有 → ホーム画面に追加 で「月輪業務」として追加できます。

【この試用版のデータ】
現時点では端末内（ブラウザ）保存です。MacとiPhoneのデータはまだ共通化されません。
次の段階で Firebase を接続すると、2アカウント・PC・スマホで同じデータを共有できます。
Google Calendar APIを接続すると、日程の読み書きと日程→案件リンクを実際のGoogle Calendarに反映できます。

【重要】
file:// で index.html を直接開くと通常のWeb画面としては使えますが、Service Worker / PWAインストールは動作しません。
PWAテストは localhost または HTTPS を使用してください。
