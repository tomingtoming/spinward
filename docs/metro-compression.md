---
origin: ai
created: 2026-09-26
---

# 都市配信データの無劣化圧縮

2026-09-26、tomingの「PLATEAU由来のデータ、効率的で効果的な圧縮方法はない？」を受けて実測。
続く「やってみよう」で可逆圧縮の実装・検証を実施。原本と旧releaseを保持し、新しい配信候補を作成した。

## 全域へ適用した結果

| 対象 | 圧縮前 | 圧縮後 | 削減 |
| --- | ---: | ---: | ---: |
| 都市配信全体 | 2,875,904,387 bytes | 2,370,602,829 bytes | 505.30 MB / 17.6% |
| バイナリ全体 | 2,249,199,682 bytes | 1,744,112,289 bytes | 22.5% |
| 三帯の地形・建物バイナリ | 898,344,630 bytes | 533,499,749 bytes | 40.6% |

全41,048バイナリを実行時と共通のdecoderで復号し、元ファイル全体のバイト一致を検査。
31,844ファイルをMeshopt+gzipへ変更し、128 bytesかつ1%以上の削減がない9,204ファイルは従来形式を維持した。
原寸Float32・Uint32、三角形順、metadata、元ヘッダーのpaddingまで復元する。頂点の量子化・間引き・並べ替えなし。
`decodedBytes`・bounds・高さ・所有タイル・外観レシピの数値は変更しない。
71,604ファイルのhash・参照閉包を新releaseでも検査し、upload dry-run成功。公開・本番切替はしていない。

新release: `ce65ac50fdc0bb7e8ddc3c7ce8de3f9243c5d2129ecefd4ce8a304574fa3c8f4`。
証跡: `qa/plateau/metro-compression-release-20260926.json`。
実体: `/Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/data-meshopt-v1`。

### 起動比較

Chrome / Apple M1 Pro / ANGLE Metal、10Mbps・100ms、1280×960、Quest描画設定。
地点・版ごとに新しい永続Chrome profileを作り、キャッシュを消して測定。比較順は渋谷が旧→新、大宮が新→旧、東京が旧→新。
操作開始時点の通信にはCDPの完了済み要求と進行中データを含める。
ChromeがWorkerのloadingFinishedを返さない分はResource TimingのtransferSizeを補い、重複集計しない。
Resource Timingの転送値には仕様上のヘッダー推計が含まれる。アプリ・共有モデル・Worker decoderも対象。

| 地点 | 旧版の操作開始 | 圧縮版の操作開始 | 旧版の転送 | 圧縮版の転送 |
| --- | ---: | ---: | ---: | ---: |
| 渋谷 | 9.315秒 | 8.649秒 | 9,426,503 bytes | 8,343,709 bytes |
| 大宮 | 9.140秒 | 8.398秒 | 9,158,720 bytes | 8,104,825 bytes |
| 東京 | 9.537秒 | 8.760秒 | 9,715,892 bytes | 8,388,367 bytes |

この測定では3地点とも10MB/10秒以下、page errors0。位置も期待する到着座標と照合した。
前段の同条件比較でも新8.486〜8.663秒、旧9.175〜9.566秒。ただし前段の通信量はWorker分が約2〜9KB過少だったため、上表を確定値とする。
従来の同一ブラウザ連続測定で起きた11.7/17.1秒の悪化原因まで解消したと解釈しない。
全景の詳細が揃う時間とは異なり、実WAN・実HMDの測定でもない。
証跡: `qa/plateau/metro-compression-startup-20260926.json`。

圧縮版で渋谷へ通常再訪した追加測定は1.389秒、集計766 bytes、キャッシュ由来63要求、page errors0。
初回は8.640秒/8,343,766 bytes。512MiBの永続Chromeキャッシュを使い、reloadではなく別ページから戻った。
WorkerのResource Timing補完600 bytesはヘッダー推計を含むため、766 bytesをパケット実測値とは扱わない。
証跡: `qa/plateau/metro-compression-cache-20260926.json`。

### 動作・外観・高速飛行

- 圧縮版のPC/VR/昼夜12ブラウザテスト成功（3.0分）。三帯の歩行・ジャンプ・飛行・着地、
  手首Placesからの三帯移動、Cooper/Elysium/Playground/Izmaの往復、三地点の昼夜、両眼の光表現を確認。
  playwright-webxr 0.3.0、実Metal GPUでのエミュレーション。実HMDでの確認ではない。
- visual-verifyによる独立した画像比較では、渋谷・大宮の夜景2組とステレオ2枚に明瞭な外観欠落・変形・片眼欠落なし。
  画角・状態差があり、案内カードに隠れた領域、暗部の微細な穴、動作中のちらつきはこの比較では保証しない。
- 大宮から30秒のキー操作による飛行を旧版/圧縮版10Mbps・100msと、圧縮版2Mbps・200msで実施。
  全て停止0、page errors0、地形ストリームの失敗0、frame p95は16.7〜16.8ms。
  終点の地表相対速度は約380m/s。遠景タイルが実際に読み替わり、常駐衝突は96件/144MiB以内。
  10Mbpsの飛行中に開始した完了レスポンス本文は旧421件/9.51MB、新421件/7.04MBだった。
  これは全通信量ではなく、経路・非同期完了タイミングも厳密には同一ではない。
  2Mbpsでは詳細の到着は減るが、遠景を保って操作は継続した。
  上空約1.2kmへ抜ける経路のため、低空で衝突タイルの読み替えを繰り返す試験とは区別する。

動作証跡: BLAZEの `production-20260925/qa-meshopt-v1`、`flight-{baseline,meshopt,meshopt-slow}-v1`。
飛行の要約: `qa/plateau/metro-compression-flight-20260926.json`。
ローカル候補は `https://127.0.0.1:5320/?city=tokyo&preset=izma`。

### 実装と検証

- `src/worlds/plateau/tile-meshopt.js`: version2を元のversion1バイト列へ復元。旧形式にも対応。
  64MiB上限、宣言長・stride・型・範囲・属性の重なりを検査してから確保/復号する。
- `assets/plateau/metro_meshopt.mjs`: offline encoder。ランタイムはdecoderだけをWorkerへ同梱し、追加の直列リクエストを避ける。
- `assets/plateau/compress_metro_release.mjs`: 既存packageから新規出力先へ変換。source hashを読み取り時に検査し、参照とcore checksumを更新する。
  一部だけ完成したディレクトリを公開しないよう、inventoryを最後に書く。既存出力先への上書きは拒否する。
  異なるgzip原本が同一出力へ集約される場合は書き込み完了を待ち、途中のファイルを比較しない。重複集約をfixtureで検査。
- 関連62単体テスト、TypeScript、production build成功。再現性・旧形式互換・破損/過大データ拒否を含む。
- 圧縮版のHTTP/破損core/任意外観失敗/必須衝突欠損→再試行、4ブラウザテスト成功（22.0秒）。

```sh
node assets/plateau/compress_metro_release.mjs \
  /Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/data-v1 \
  /Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/data-meshopt-new
python3 assets/plateau/publish_metro_release.py \
  --package /Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/data-meshopt-new \
  --report /Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/dry-run-meshopt-new.json
```

## 配布データの内訳

対象release: `c5cbf79810bd55169494049072c3f49a071315f7edf5c83dc4115c8e198f27ad`。
全71,604ファイルのinventoryを集計。容量は十進数。

| 内容 | ファイル数 | 保存容量 | 比率 |
| --- | ---: | ---: | ---: |
| 形状・照明等の `.bin.gz` | 41,048 | 2,249.20 MB | 78.2% |
| 外観レシピ・索引等の `.json.gz` | 10,186 | 507.66 MB | 17.7% |
| PNG画像 | 20,367 | 118.39 MB | 4.1% |
| 出典GeoJSON・release JSON | 3 | 0.65 MB | 0.02% |

原典CityGMLをそのまま配っているわけではなく、現在の形状はFloat32属性・Uint32インデックスをgzip圧縮した独自タイル。
地表仕上げは道路・水面・土地利用の境界を5m地形三角形に沿わせたベクトル面であり、主因を写真テクスチャと見なさない。

## 可逆圧縮の標本比較

`qa/plateau/metro-compression-profile.mjs` を追加。既存lockfileのmeshoptimizer 0.22.0、Node24.19.0を使用。
カテゴリごとの保存容量10/50/90パーセンタイルの標本と、core・3帯のdetail索引で計32ファイル。
うち22バイナリでは、復号した全Float32/Uint32属性のバイト一致をassertした。
インデックスはsequence codecを使い、順番・三角形の先頭頂点・所有タイルのsegment範囲を変えない。
量子化・頂点並べ替え・面の間引きは行っていない。インスタンスのstrideは窓40、灯具28、低層建物36 bytes。

| 種類 | 標本数 | Meshopt + gzip(level5) | Brotli(quality9)のみ |
| --- | ---: | ---: | ---: |
| 近景の地形・建物 | 3 | 43.8%削減 | 18.2%削減 |
| 中景の地形・建物 | 3 | 33.8%削減 | 12.8%削減 |
| 全体を見渡す遠景 | 3 | 32.6%削減 | 19.7%削減 |
| 地表仕上げ | 3 | 14.6%削減 | 21.7%削減 |
| 夜の窓インスタンス | 3 | 23.4%増加 | 12.6%削減 |
| 灯具インスタンス | 3 | 16.2%削減 | 12.8%削減 |
| 低層建物インスタンス | 3 | 11.1%削減 | 3.1%削減 |
| 外観レシピ | 3 | 対象外 | 4.9%削減 |
| 起動用core索引 | 1 | 対象外 | 10.9%削減 |
| 帯別詳細索引 | 3 | 対象外 | 26.3%削減 |

率は各行の標本合計に対する値。都市全件の削減率へ外挿しない。詳細なサイズ・復号時間・元パスは
`qa/plateau/metro-compression-20260926.json`。Node/WASM上のCPU復号時間であり、ブラウザ・Questの操作開始時間ではない。
生データにgzipのみの計測は展開まで、Meshopt側は追加でヘッダー解析と属性配列の復元までを含む。
再実行用コマンド:

```sh
node qa/plateau/metro-compression-profile.mjs \
  /Volumes/BLAZE/Spinward/inland-b-20260924/production-20260925/data-v1 \
  /tmp/spinward-compression-profile.json
```

## 次の実装候補

1. 既存のタイル粒度・出典・衝突契約を保持し、近景・遠景のMeshopt+gzipを第一候補とする。
   ブラウザでは既存Workerに復号を追加し、デコーダーの取得・初期化費用も含めた操作開始を比較する。
   大きくなる形式は採用しない。形状・segments・boundsを保ち、新releaseとして全件復号一致を検査する。
2. 地表仕上げ・索引のBrotliを比較する。現在はgzipを不透明オブジェクトとして配っているため、
   HTTP Content-Encoding、ブラウザの自動展開、checksumの対象バイト列を一体で設計し直す必要がある。
   ファイル拡張子だけを変えたり、gzipの上からBrotliをかけたりしない。
3. 必要なら許容誤差を定めた座標量子化・法線圧縮・外観レシピの数値バイナリ化を別途検証する。
   隣接タイルの境界は同じグリッドにそろえ、建物と外観・道路と地形のずれ、段差・接触を確認する。
   衝突の精度や照明の差を無条件に許容しない。色と法線も単なる8bit化ではなく色空間・角度誤差で評価する。
4. KTX2/Basisは画像の通信量とGPUメモリを別々に測る場合の候補。画像は全体の4.1%なので配信総量では優先度を下げる。

上記1を新releaseとして実装した。2以降は次の候補であり採用済みではない。Draco・KTX2・量子化の比較測定は未実施。
圧縮は通信量を減らすが、同じ属性へ復元する可逆codecでは常駐GPUメモリ・ポリゴン数は減らない。
同時要求数や初期化・描画負荷による遅延は別途測る。起動の確定比較は本書上段に記録した。

公式資料（2026-09-26参照）:

- [Meshoptimizer](https://github.com/zeux/meshoptimizer): 可逆codecと、その前段の量子化を区別。
- [Brotli](https://github.com/google/brotli): 汎用の可逆圧縮。
- [KTX Artist Guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXArtistGuide.md): GPUテクスチャの圧縮選択。
