【v5.2 クリーン版】
この版は初回起動時に旧試用版のローカル履歴・業務データ・帳票保存履歴を消去し、空の状態から開始します。
一度初期化した後は、新しく登録したデータは通常どおり保存されます。

月輪合同会社 業務連動システム PWACalendar API 接続版 v5（Google Calendar API）

1. GitHub Pages の既存ファイルをこのフォルダ内容で置き換えます。
2. https://sayonaraumi-tech.github.io/geruninn/ を開きます。
3. 日程 → 「Googleに接続」→ Googleアカウントで許可。
4. 対象月を選び「Google日程を同期」。
5. 日程から見積・請求・領収を作成して保存すると、Google Calendar の元予定タイトル/説明へ反映します。
6. 祝日・休み・有休・公休・OFF等は業務日程から除外します。

注意：
- OAuth Client ID は組み込み済みです。Client Secret は不要です。
- Google Auth Platform がテストモードの場合、使用するGoogleアカウントを Test users に追加してください。
- Firestoreはまだ未接続です。スマホとPCの業務データ自体は現時点では各端末ローカル保存です。
