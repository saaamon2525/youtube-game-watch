# YouTube Game Watch

参考にしているYouTubeチャンネルの動画を収集し、ゲーム名・サムネイル・再生数・盛り上がり度で見られるローカルサイトです。

## 使い方

```powershell
cd C:\Users\saamon\Documents\Playground\youtube-game-watch
npm start
```

ブラウザで `http://localhost:4173` を開きます。

1. `APIキー` ボタンから YouTube Data API キーを保存します。
2. `収集` ボタンで動画情報を取得します。
3. チャンネル、ゲーム名、投稿日、盛り上がり度で絞り込みます。

APIキーは `config/settings.local.json` に保存されます。このファイルは `.gitignore` 対象です。

## 毎日収集

サイトと同じAPIキーを使って、次のコマンドで収集だけ実行できます。

```powershell
cd C:\Users\saamon\Documents\Playground\youtube-game-watch
npm run collect
```

Codexの毎日タスクにはこのコマンドを午前3時で登録する想定です。

## GitHub Pages

GitHub Pages版は静的サイトとして動きます。YouTube Data APIキーはリポジトリの Actions Secret `YOUTUBE_API_KEY` に保存してください。

`.github/workflows/pages.yml` が毎日 03:00 JST に動画データを収集し、`data/videos.json` を更新して GitHub Pages に公開します。手動実行は GitHub の Actions タブから `Collect YouTube data and deploy Pages` を選んで `Run workflow` します。

予定ゲームのブックマークは公開データにはせず、各ブラウザの `localStorage` に保存されます。予定ゲーム画面の「ブラウザ保存を削除」で消せます。

## チャンネル追加

`config/channels.json` に次の形式で追加します。

```json
{
  "name": "チャンネル名",
  "url": "https://www.youtube.com/@handle",
  "handle": "@handle",
  "enabled": true
}
```

## ゲーム名辞書

`config/game_aliases.json` にゲーム名と別名を追加すると、自動分類の精度が上がります。
