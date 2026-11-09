# 鮎日記（Ayu-Nikki）

友釣り専用の釣行日記・記録手帳アプリ（Android向け PWA）。仕様は [SPEC.md](SPEC.md)。

## できること

- **1釣行＝1枚のカード**。横スワイプで前後の釣行に切り替え
- **釣行前／釣行後** の2タブで入力。入力のたびに自動保存
- 面河川・土居川・仁淀川・久万川をワンタップ選択。面河川は観測所「仕出」を自動入力し、水位ページへのボタンを表示
- 水位は言葉（平水など）と数値（cm、マイナス可）の両方
- 仕掛けは「前回の仕掛け」「プリセット」からワンタップ入力
- **検索**（河川・シーズン・期間・水位・濁り・垢・匹数・キーワード）。結果の中だけでカードをスワイプ
- **LINEで送る**：カードを画像にしてAndroidの共有メニューへ
- **シーズンまとめ**：画面で集計を表示し、Excel（釣行一覧＋集計の2シート）で出力
- **バックアップ**：JSONで書き出し・読み込み
- オフライン動作（電波のない河原でも使える）

データはすべてスマホの中（IndexedDB）に保存され、外部には送信しません。

## スマホで使う（GitHub Pages で公開）

1. このブランチを `main` にマージする
2. GitHub のリポジトリ → **Settings → Pages** → Source を「Deploy from a branch」、Branch を `main` / `/ (root)` にして保存
3. 数分後に表示される URL（`https://<ユーザー名>.github.io/Ayu-Nikki/`）を Android の Chrome で開く
4. Chrome のメニュー →「ホーム画面に追加」（または「アプリをインストール」）

友人にも同じ URL を送れば、各自のスマホで使えます（記録は各自の端末に別々に保存されます）。

## 開発

ビルド不要の素の HTML / CSS / JavaScript（ES Modules）です。

```bash
python3 -m http.server 8000   # http://localhost:8000 で確認
node --test tests/*.test.mjs  # 検索・集計・Excel出力のテスト
```

ファイルを変更したら `sw.js` の `VERSION` を上げてください（オフライン用キャッシュの更新）。

| ファイル | 役割 |
|---|---|
| `js/app.js` | 画面（カード・入力・検索・まとめ・設定） |
| `js/model.js` | データ項目・選択肢・共通処理 |
| `js/search.js` | 検索 |
| `js/stats.js` | シーズン集計 |
| `js/export.js` / `js/xlsx.js` | Excel出力（ライブラリなし） |
| `js/share.js` | カード画像の作成とLINE共有 |
| `js/db.js` | 端末内保存（IndexedDB） |
| `sw.js` / `manifest.webmanifest` | オフライン対応・ホーム画面アプリ化 |
