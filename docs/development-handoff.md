---
origin: collaborative
created: 2026-09-29
---

# 東京版・Quest改善の開発引き継ぎ

2026-09-29、tomingは開発を一旦停止し、`/Volumes/BLAZE/Spinward` を今後の開発用に
toming-serverへ移したと報告。続いてコードのブランチ作成・commit・pushを指示した。
新規開発・mainへのマージ・本番切替・定期開発の再開は今回の作業に含めない。

## コードとデータ

- 開発ブランチ: `codex/tokyo-metro-quest-20260929`。
- Git: https://github.com/tomingtoming/spinward 。既存の手作り都市の開発履歴も継承する。
- Macの作業ツリー: `/Users/toming/keel/lake/spinward-development`。
- 移設先: `toming-server:/home/toming/Spinward/inland-b-20260924`。
  AIは同日SSHでディレクトリ、共有素材、最新検証アーカイブの存在を確認。
  PLATEAU原典全件の移設前後の照合を今回やり直したという意味ではない。
- `raw/` はPLATEAU原典、SQLiteは変換用索引、`derived/` は生成済みデータ。
- 圧縮公開パッケージ: `production-20260925/data-meshopt-v1`。
- 共有モデルパッケージ: `production-20260925/shared-v1`。
- 最新配布物と検証: `production-20260925/quest-tight-overview-20260929`。
  `package-final/` が今回の配布入力。`rejected/` の実験は製品へ適用していない。

従来の文書にある `/Volumes/BLAZE/Spinward/` はMacでの当時の保存先。
サーバーでは `/home/toming/Spinward/` に読み替える。環境変数で入力・出力を明示し、
既存の配布物や検証記録を新しいbuildの出力先として使わない。

## 別保管した生成アセット

今回のコード保存時点でGit未収録だった街区JSONとBlenderモデル、および更新された
`izma-far-ground.blend` は、合計1,584ファイル・2,075,582,841 bytes。
新しい大容量データをGitへ追加せず、サーバーの次の専用ディレクトリへ保存した。
同日、転送後の1,584ファイルをSHA-256で全件照合し一致した。

`/home/toming/Spinward/development-assets-20260929/repository/`

パスとSHA-256の正典は [development-assets.sha256](development-assets.sha256)。
これは既存Git資産に重ねる差分データであり、単独で全アセットを含むものではない。
コード、テスト、生成スクリプト、設計JSON、実行用manifestはGitに含める。
`.gitignore` は新しい `.blend` と街区データを除外する。既に追跡している資産の履歴は維持する。
Macに残した更新済み `izma-far-ground.blend` はGit上では変更ありと表示されるが、上のデータ保管対象。

### 新しいcloneで復元する（toming-server）

既存の作業ツリーへ無条件に重ねない。新しいcloneのルートで実行する。
既存ツリーを再利用する場合は、同名資産の自分の変更を先に別の場所へ保存する。

```sh
git clone --branch codex/tokyo-metro-quest-20260929 https://github.com/tomingtoming/spinward.git spinward-tokyo
cd spinward-tokyo
export SPINWARD_REPOSITORY_ASSETS=/home/toming/Spinward/development-assets-20260929
rsync -a "$SPINWARD_REPOSITORY_ASSETS/repository/" ./
sha256sum --quiet --check docs/development-assets.sha256
bun install --frozen-lockfile
bun test
bun run build
```

全単体テストには旧手作り都市の実データ・参照閉包検査があるため、先に上の復元が必要。
不足データを理由にテストをskipして合格扱いにしない。
復元後の追跡済み `.blend` の差分は生成アセットの更新であり、コード変更とは分けて扱う。

## 東京版のbuild

公開候補と同じCDNデータを使うアプリbuildでは、PLATEAU原典全体は不要。
サーバー上で入力を指定し、毎回新しい出力先を作る。

```sh
export SPINWARD_METRO_ROOT=/home/toming/Spinward/inland-b-20260924
export SPINWARD_SHARED_PACKAGE="$SPINWARD_METRO_ROOT/production-20260925/shared-v1"
export SPINWARD_METRO_OUTPUT="$(mktemp -d /tmp/spinward-metro-build.XXXXXX)"
export VITE_METRO_DATA_ROOT=https://data.spinward.toming.app/
export VITE_METRO_RELEASE=releases/ce65ac50fdc0bb7e8ddc3c7ce8de3f9243c5d2129ecefd4ce8a304574fa3c8f4.json
bun run build --config vite.metro.config.mjs
```

これはbuildのみで公開しない。ローカルプレビューは空きポートと自分のプロセスを確認して
起動する。配布には [配信手順](metro-production-delivery.md) のallowlistパッケージ化を使い、
リポジトリ全体やデータ作業ディレクトリを配信rootに指定しない。

## 公開状態と実機の観測

- 本番 `spinward.toming.app` には東京版・今回のQuest改善を未適用。mainは変更しない。
- 候補: https://spinward-metro-candidate.toming.workers.dev/?city=tokyo&preset=izma&depth=log
- 候補Worker版: `6760f1e9-a694-416b-9518-52200dd4aec2`。
- 都市データ: R2 `spinward-metro`、配信 `https://data.spinward.toming.app/`。
- データrelease: `ce65ac50fdc0bb7e8ddc3c7ce8de3f9243c5d2129ecefd4ce8a304574fa3c8f4`。
- 本人のQuest 3Sは閲覧履歴の消去後にVR入場可能になった。以降の軽量化による改善も本人が報告。
  ただし依然として負荷が高い。実機FPSの計測・快適動作の合格判定は未了。
- XR解像度100%を維持。遠景z-fightingが強まる通常深度への変更は本人が却下し、対数深度を維持。
- 最新変更は両眼frustumによる街区カリング。36視点で描画三角形0〜19.4%減、72眼の画像差分0。
  Apple M1 ProのGPU時間短縮は約1〜2%と小幅で、Quest実機の改善率へ外挿しない。
- `playwright-webxr 0.3.0` で実VR入場・手首UI・再入場を検査。
  最新のローカル7件と公開URL2件は成功。条件は
  [最新QA](../qa/plateau/quest-tight-overview-20260929.md) に記載。

候補版公開時点のコード575ファイルは保存作業前にSHA-256で一致を確認した。
保存時の再検査では、全市のraycastと64,000棟の街路検査の2件が既定の期限で時間切れになったため、
その2件のみテスト実行期限を延長した。検査内容と製品の実行コードは変更していない。
過去の試作と本番未適用の変更を取り違えず、次の開発依頼から再開する。

## コード保存時の検証

- `bun test`: 244ファイル・1,324件を実行、1,321件成功、3件が時間切れ。
  2件は上記の期限調整後に再実行。もう1件の到着街路16,000棟検査はコードも期限も変更せず再実行した。
  関連5件の再検査は全て成功（42.76秒）。全体一括実行が最初から成功したとは扱わない。
- `bun run build`: TypeScriptとVite buildが成功。
- `git diff --cached --check`: 成功。
- 別保管アセット: サーバーの1,584ファイルをSHA-256で全件照合し一致。
- この保存作業ではアプリの再デプロイを行っていない。
