# Spinward

**Held by the spin. Not by gravity.**

回転居住区の人工重力を、説明ではなく身体で理解する WebXR デモ。
A WebXR experiment in rotating habitats.

## In English

**[spinward.toming.app](https://spinward.toming.app/)** — walk the inside of a spinning O'Neill cylinder in your browser. No install: Meta Quest browser (WebXR), desktop, or phone.

The city looks ordinary until you look up and see the far side of town hanging overhead. Then you throw a ball and it curves (Coriolis). You jump and the floor slides sideways to meet you. You ride up to the axis and your weight goes away. The physics runs in the inertial frame with [Rapier](https://rapier.rs/); only the rendering happens in the rotating frame with [three.js](https://threejs.org/). The curve, the sideways drift, and the weightlessness are what falls out of that, not scripted effects.

A three-minute tour: throw → jump → **2** Overlook (weaker gravity near the axis) → **3** Axis (zero-g) → **4** Exterior (watch the whole colony turn). Change the spin rate and feel `g = ω²R`. Turn on rain and watch every drop lag the spin. Share any view with its URL — the link unfurls with that view's own description.

Default habitat is *Izma Colony* (3.2 km radius, 40 km long, 1 g). Controls for PC / Quest / phone are in the table below; the VR bindings are in [docs/vr-controls.md](docs/vr-controls.md). Source is under [AGPL-3.0-or-later](#license). The rest of this README is in Japanese.

見上げると反対側の街が空にある。歩くと普通の街なのに、投げる・跳ぶ・中心軸へ行くと物理が変になる——回転コロニーの「景観」と「人工重力の違和感」を 3 分で体験することを狙った、SF 好き向けの物理実験型 VR デモです。

`vite + typescript + three.js + rapier` で構成し、Meta Quest のブラウザ・PC ブラウザ・スマホの 3 環境で動きます。Rapier の慣性系シミュレーションと回転座標系の表示変換を分離したまま、「投げると曲がる(コリオリ)」「ジャンプすると床が迎えに来る」「軸に近づくと重力が抜ける」「回転速度を変えると世界が軽くなる」を体験できます。

## 3分体験の流れ

初期スポーンは **Izma Colony**(半径 3.2km・全長 40km・1g)です。小スケールで物理を試したい場合は画面下ドックの preset チップ(VR では wrist UI)から Playground プリセットへ切り替えられます。URL に `?preset=playground|izma|cooper|elysium` を付けると任意のプリセットで起動できます。

1. **地表(Surface)** — 円筒内壁の街に立つ。空の向こうに反対側の街、採光窓のストライプ、中心軸の光が見える。
2. **投げる・跳ぶ** — ボールは真っすぐ飛ばない。ジャンプ中は何にも引かれず、床が横にずれて迎えに来る。説明カードが画面下に短く出ます。
3. **展望地点(Overlook)** — `2` キーまたは画面下の Travel ボタン(VR では wrist UI)から。軸に近いほど回転速度が遅く「重力」が弱い。落下すると街が横へ流れていく。
4. **中心軸(Axis)** — `3` キーで軸端へ。回転半径ゼロ=無重量。街が空になる。`4` キーの Exterior でコロニーの外殻の外へ出て、回る全体を眺めることもできる。外は真空: 世界の音がすべて消え、自分の呼吸と心拍だけが残る。
5. **回転速度を変える** — 画面下の Spin −/+(VR では wrist UI の rpm)で `g = ω²R` を体感する。
6. **雨を降らせる** — 画面下の Rain ボタン(または URL に `?rain`)。雨は回転に置いていかれて斜めに降り、傾きは高度で変わる。雲は重力の弱い軸付近に張りつくので、Axis へ向かって昇っていくと雨の上に出る。

## 操作(主要)

VR の全バインドと挙動は [docs/vr-controls.md](docs/vr-controls.md) にまとめています（合言葉は「左手が飛ばし、右手が世界に触る。A＝上・B＝メニュー」）。

| 操作 | PC | Quest | スマホ |
| --- | --- | --- | --- |
| 移動 | WASD | 左スティック(grip で登攀クラッチ) | 画面左の仮想スティック |
| 視線 | 画面クリックでマウス追従(Esc で解除) / 右ドラッグ / 矢印キー | 頭 + 右スティック snap turn | ドラッグ / Gyro ボタンでジャイロ |
| 投げる | 左クリック(長押しでチャージ) | 右トリガー(チャージ可) | タップ |
| 弾種切替(Ball / Beam / Firework) | X / 右クリック、または ◈ チップ | —(非VR画面で切替) | ◈ チップのドロップダウン |
| ジャンプ | Space(押しっぱなしで上昇継続) | A ボタン(左右どちらでも) | Jump ボタン(長押しで上昇継続) |
| ワープ | 1 / 2 / 3 / 4(地表 / 展望 / 軸 / コロニー外)、または Travel ボタン | 右手 B / wrist UI の Travel | Travel ボタン(Surface / Overlook / Axis / Exterior) |
| 回転速度 | Spin −/+ ボタン、または `-` / `=` キー | wrist UI の rpm | Spin −/+ ボタン |
| 雨 | Rain ボタン、`R` キー、または URL に `?rain` | —(VR 入場前に非VR画面で切替) | Rain ボタン |
| 共有 | Share: Link(この視点のURLをコピー・`L` キー) / Photo(PNG保存・`P` キー) | — | Share: Link(共有シート) / Photo |
| 操作ガイド | CONTROL チップにホバー / クリック | 左手首の watch UI(左 B でリセンター) | CONTROL チップをタップ |
| 離陸(free-fly) | F | A(ジャンプ) | Jump 長押し |

非VR環境では画面下に 1 本のドックが常時出ます: 左に CONTROL・preset・ステータスチップ(felt g / ω rpm / mode / balls / ◈ 弾種)、右に Travel・Spin・(対応環境なら)VR ボタン。スマホはさらに Jump / Drive / Gyro のボタン列が出ます。iOS ではジャイロ使用時に Gyro ボタンから許可ダイアログが出ます。

## セットアップ

```bash
bun install
```

## 開発サーバー

```bash
bun run dev
```

PC 側で `https://<PCのIPアドレス>:5173` を開ける状態になります。Quest ブラウザで開くには、PC と Quest を同じネットワークに置いてアクセスしてください。

## ビルド

```bash
bun run build
bun run preview -- --host 0.0.0.0
```

## デプロイ(Cloudflare)

本番は static-assets-only Worker(`wrangler.jsonc`、Worker スクリプトなし)で、Vite が `dist/` にビルドした成果物を Cloudflare がそのまま配信します。本番 URL は `https://spinward.toming.app/` です。

デプロイは **Cloudflare Workers Builds**(Cloudflare 側で GitHub リポジトリに接続)が担います。`main` への push でビルド＋本番デプロイが自動実行され、PR では検証用ビルドが走ります(PR の `Workers Builds: spinward` チェック)。GitHub Actions(`.github/workflows/ci.yml`)は `bun test` と `bun run build` の品質ゲートのみで、デプロイはしません。

手元から手動で反映したい場合:

```bash
bun run deploy   # = bun run build && wrangler deploy
```

初回は `wrangler login`(または `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を環境変数に設定)してください。Worker name は `wrangler.jsonc` の `spinward` です。

OGP は `index.html` のメタタグ(og:/twitter:、canonical は `https://spinward.toming.app/`)と `public/og.jpg`(1200×630 のソーシャルカード)・`public/favicon.png` で構成しています。カード画像は実ゲームのヒーローショットにワードマークを合成したものです。ハッシュ付きアセット(`/assets/*`)には `public/_headers` で immutable キャッシュを効かせています。

## Quest での注意

- WebXR の `immersive-vr` は HTTPS が必要です。
- Vite の開発サーバーは自己署名証明書なので、Quest 側で証明書警告が出る場合があります。
- 確実に VR ボタンを有効化したいなら、`dist/` を有効な HTTPS 証明書を持つホスティングに配置してください。

## 操作

- VR: 右手だけが球生成と投擲を担当します。何もない空間で右トリガーを引くと手元に球を生成し、そのまま掴みます。
- VR: ロコモーションは「左手＝移動、右手＝世界。A＝上・B＝メニュー(両手共通)」。全バインドと挙動は [docs/vr-controls.md](docs/vr-controls.md) を参照。
- VR: `grounded` 中は左スティックで歩きます。左 grip を握って手を壁面に沿って動かすと、クラッチで登攀／引き寄せできます(手元に出る小さな軸とラインが相対入力を示します)。A ボタン(左右どちらでも)で `free-fly` へ離陸します。
- VR: `free-fly` 中は左トリガー(左コントローラの指す方向へ、アナログ・スロットル)と左スティックで推進し、A 長押しで上昇します。向きは右スティックの snap turn で変えます。
- VR: `free-fly` 中は左 grip を握ると停止(アナログのブレーキ)します。止めるのは直線ドリフトだけで、自転 ω は保持されるためコロニーは視界で回らず安定したままです。
- VR: 左手首には wrist UI が常時表示されます。右手レーザーで狙い、右トリガーで `rpm / radius / throw / jetpack / reattach` を変更できます。
- VR: wrist UI(PC では `?debug` の GUI)から `jetpack thrust` も調整できます。
- VR: wrist UI から `Playground / Izma / Cooper / Elysium` preset を即時適用できます。適用時は habitat と Rapier scale を再構築し、球をクリアして内壁中央へ respawn します。
- VR: wrist UI の Travel から `Surface / Overlook / Axis / Exterior` の 4 地点へワープできます。
- VR: wrist UI は `-- / - / + / ++` の 4 ボタンで fine/coarse を分けています。`rpm` は 3 桁有効、`radius` は大きな habitat でも有効桁ベースで step が自動で変わります。
- VR: 右スティック左右の `snap turn` は `grounded` / `free-fly` の両方で効きます。右手のトリガー(投擲・UI)とは独立です。
- VR: 球のトリガーを離すと放します。投げ速度は右手の相対運動と前方チャージから決めます。
- VR: 球はトリガー長押しで前方チャージされ、短押しではプレーヤーに対して相対速度 0 から始まります。
- VR: 球を握っている間は、チャージ量に応じて色がオレンジから水色へ変わります。
- VR/PC: 球は建物に当たると跳ね返ります(建物は回転系で静止しているので、回転系の相対速度で反射します)。
- VR/PC: 球はシリンダー開口部から外へ抜けられます。
- VR/PC: プレイヤーも端で止まらず、そのまま開口部の外へ出られます。
- VR/PC: `free-fly` 中でも、内壁へ低速で戻れば自然接触で `grounded` に戻ります。
- VR/PC: `free-fly` 中は、最寄りの内壁ドッキング位置へ伸びる in-world guide が出ます。`ready` で緑、それ以外は青です。
- PC: キャンバス左クリックで球を前方へ投げます。
- PC: `Space` でジャンプします。空中では何も引かないので、床のほうが曲がって迎えに来ます。着地すると自動で `grounded` に戻ります。助走の運動量はジャンプ後も保存されます。
- VR/PC: 空中ではビルにも衝突します。ビルの屋上には着地でき、屋上の上をそのまま歩けます。縁から踏み出せば自由落下です。
- VR/PC: 着地時は落下速度に応じて視点が沈み込み、バネで戻ります(膝のクッション)。
- PC: `1 / 2 / 3 / 4` で 地表 / 展望地点 / 軸端 / コロニー外 へワープします(画面下の Travel ボタンでも同じ)。
- PC: `X` または右クリックで投射物を Ball / Beam / Firework に切り替えます(HUD の ◈ ドロップダウンでも選べます)。
- PC: `F` で壁から離陸して `free-fly` に入れます。
- PC: 内壁にいる間は `WASD` で歩行します。`free-fly` 中は KSP 風の視線基準 6DOF ジェットパックで、`WASD` で前後左右、`Space` で上昇、`Shift` で下降します。`Q/E` のロールは角速度ベース(押すと回転が立ち上がり、離しても惰性で回り続ける)で、`B` でそのロールを止められます。`grounded` に戻ると視点は自動で水平へ戻ります。
- PC: 画面を左クリックするとマウスが視線に追従します(Esc で解除、`?lock=0` で無効化)。右ドラッグまたは矢印キーでも回せます。
- 非VR: 画面下のドックにすべての操作 UI が集約されています。左クラスタが CONTROL(ホバー / タップで操作カードが数秒表示されて消える)・preset ドロップダウン・ステータスチップ、右クラスタが Travel(Surface / Overlook / Axis / Exterior)・Spin −/+・フルスクリーン・VR ボタンです。細かい設定(半径・全長・スロー・ジェットパック・リアタッチ・昼夜サイクル長など)は `?debug` の GUI に移りました。
- スマホ: 画面左側のタッチがバーチャルスティック(歩行 / free-fly 推力 / 運転)、右側のドラッグで視線、右側タップで投擲です。下部のボタン列に Jump・Drive(車の近くで出現、乗車中は Exit と Brake)・Gyro(ジャイロ視点)が並び、Travel と Spin はドックのボタンを使います。
- スマホ: 描画はモバイル品質(pixelRatio 上限 1.75、建物 6000 棟、雲 50%)に自動調整されます。着地や衝突で軽い振動フィードバックが入ります(Android)。ホーム画面に追加すればフルスクリーンの PWA として起動します。
- HUD はドック左クラスタのチップ列です: preset(タップで切替)/ felt g・速度 / ω rpm / mode / balls / ◈ 弾種(タップで切替)/ free-fly 中のみ reattach 距離。デバッグ数値を見たいときは URL に `?debug` を付けます。
- **音響**(全合成、アセットなし):ハビタットの環境音、スロー/バウンド/ジャンプ/着地/UIクリックのSFX。初回操作で有効化され、`M` でミュートできます。ボールのバウンド音は衝撃と距離で減衰します。
- 起動時にはスプラッシュ(SPINWARD)が出て、ロード完了でフェードアウトします(初期化に失敗した場合はスプラッシュ上にエラーと RELOAD ボタンが出ます)。lil-gui のデバッグパネルは URL に `?debug` を付けたときだけ表示されます。
- GUI(`?debug`): `radius`, `rpm`, `surface g`, `span`, `simScale`, `preset`, `throw scale`, `jetpack`, `reattach` 閾値を右上で確認/調整できます。
- GUI: `observer` で `colony-fixed / inertial-fixed` を切り替えられます。`inertial-fixed` は現在 PC 向けで、XR 中は自動で `colony-fixed` に戻ります。
- GUI: `trail mode` で `Rotating / Inertial / Both` を切り替えられます。
- GUI: `frame err` は回転系速度差分から見積もった加速度と、擬似力計算のズレ警告しきい値です。
- HUD: `free-fly` 中は reattach チップに、内壁再接地までの残り距離と `ready` 状態が出ます。
- GUI(`?debug`): 追跡球について `v_inertial`, `v_rot`, `a_fictitious`, `a_rot_est`, `err` を確認できます。誤差がしきい値を超えると `Frame mismatch!` を出します。
- 左手は locomotion 専用で、球生成と投擲は右手に集約しています。

## 車でドライブ(PC)

- スポーンの隣に車が駐車しています。近づいて `E` で乗車、`W/S` 加減速・`A/D` ステア・`Space` ブレーキ・`E` 降車。
- 車はプレイヤーのような「壁への張り付き」ではなく、**慣性系の剛体**として回転壁パネルに乗り、人工重力(共回転の遠心力)で自然に接地します。
- **グリップは法線荷重に比例**(`grip = g/9.8`)します。タイヤの加速・制動・旋回・横滑り抑制すべてが表面重力でスケールするため、**走行中に RPM を下げるとグリップが抜けて滑り出します**。空中ではタイヤは無力です。
- 駐車中はキネマティック共回転、運転中のみ動的ボディになります。建物との衝突は簡易(押し出し+減速)です。VR からは現状観賞のみ(運転は PC)。

## 座標系と式

- シリンダー中心軸と長手方向は `+Y`、半径方向は `XZ` 平面です。
- 角速度ベクトルは `Ω = (0, ω, 0)` です。
- 人工重力の目安は `g = ω^2 R` です。
- ここでの `1G` は「内壁位置での局所的な遠心加速度の大きさ」です。小半径・高rpmでは Earth の一様重力とは見え方がかなり違い、コリオリも強く出ます。
- Rapier world は慣性系で動かしています。
- 回転座標系は表示、入力解釈、デバッグ可視化のための変換層です。
- 設定や HUD に出す寸法は `real` メートル系です。
- Rapier world に渡す位置、速度、collider 寸法は `sim = real * simScale` です。
- 描画と回転座標系変換は `real` 側で統一しています。Rapier 境界だけが `sim` を扱います。
- 単位変換は [src/units/units.ts](src/units/units.ts) 経由のみです。
- Rapier との境界は [src/physics/rapierBoundary.ts](src/physics/rapierBoundary.ts) へ集約しています。
- runtime 側では raw `simScale` を直接ばら撒かず、`UnitsContext` を生成して boundary API へ渡します。
- 球と `free-fly` プレイヤーの内部状態は慣性系で保持し、描画時に回転系へ戻しています。
- `grounded` プレイヤーだけは内壁拘束ロジックを使います。
- Trail は 2 系統あります。
- `Rotating`: コロニー観測者基準なので曲がって見えます。
- `Inertial`: 慣性観測者基準なので、壁接触がなければ直線に近く見えます。
- 回転座標系で使う見かけの加速度は以下です。

```text
a_c  = -2 (Ω × v)
a_cf = -(Ω × (Ω × r))
```

## Presets

- Playground Colony: 半径 `18m`, 全長 `120m`, `5rpm`, `simScale 1`
- Izma Colony: 半径 `3200m`, 全長 `40000m`, 周期 `113.5s`, `0.5286rpm`, `simScale 0.02`
- Cooper Station: 半径 `3200m`, 全長 `32000m`, `0.5rpm`, `simScale 0.02`
- Elysium: 半径 `30000m`, リング厚み `2000m`, 周期 `348s`, `0.1724rpm`, `simScale 0.005`
- Elysium は現在の traversal と collider を保つため、見た目と接触は「短い axial band を持つ ring 近似」として扱っています。

## Travel(ワープ 4 地点)

- `Surface`: 円筒中央の内壁プラザへ戻り、`grounded` で開始します。
- `Overlook`: プラザ上空(半径の 1/2、8〜60m にクランプ)へ共回転状態で出ます。弱い遠心「重力」でゆっくり落下し、着地すると自動で `grounded` に戻ります。
- `Axis`: cylinder では宇宙港のある −Y 端(ミラーの根本側)の回転軸上、ring ではリング中心へ戻り、`free-fly` 0g で開始します。
- `Exterior`: コロニー外殻の外(共回転・`free-fly`)へ出て、採光窓とミラーを備えた回転体の全景を眺めます。ジェットパックでそのまま船外遊泳できます。

## Cityscape(円筒都市)

- O'Neill 型に 3 本の地表ストリップと 3 本の採光窓ストリップを交互配置し、スポーン地点周辺はプラザとして空けています。
- **採光窓は本物の開口**です。内壁シェルから窓の円弧を切り抜き(`subtractArcIntervals`)、窓越しに星空と、外側の 3 枚の**太陽ミラー**が見えます。ミラーは Island Three 方式で、片側の端部にヒンジして軸に対して 45° に傾いた長大なペタルです(軸方向に届く太陽光を 90° 曲げて窓へ入れる configuration で、窓中心方位からの太陽光 DirectionalLight と整合します)。シェルの高分割アークは量子化したフォーカス角で再構築し、UV は絶対角度でベイクするので継ぎ目なくグリッドが続きます。
- **太陽光は窓から差します**。窓の中心方位から内向きの DirectionalLight ×3(コロニー固定)で、建物に窓由来の陰影がつきます。
- **建物は側面に窓明かりテクスチャ**(emissiveMap、屋根は無地)を持ち、夜の街区が自然に光ります。
- **近景建物は Blender 製の日本都市キット**:戸建て・中層住宅・複合スラブ・タワーの4系統を GLB から一度だけ読み込み、LOD0(ベランダ・庇・窓格子・室外機・縦看板・屋上設備)と LOD1(簡略シルエット)をアーキタイプ単位の InstancedMesh で配置します。GLB が読めない場合は手続き生成建物へ自動フォールバックします。編集ソースは `assets/blender/spinward-buildings.blend`、再生成スクリプトは `assets/blender/build_spinward_buildings.py`。
- **素材写真は形と密度の資料として使い、写真テクスチャは直接貼りません**。実在店舗・住所を避けた架空の低コントラスト看板と、既存の手続き生成外壁を組み合わせ、反復する汚れや人物が外壁へ焼き付く不快さを防ぎます。
- **エアロパースペクティブ**:`FogExp2` を半径連動の濃度で適用し、反対側の街が霞みます(星空・ミラーは fog 対象外)。レンダラは ACES Filmic トーンマッピング。
- **昼夜サイクル**(デフォルト 180 秒/周、GUI の `day cycle (s)` で変更・0 で停止):昼はミラーが輝いて窓から太陽光が差し、夜はミラーが青く沈み、建物の窓明かりと街灯が主役になります。霧・背景色・軸スパインも連動します。
- **雲**:地表からの高度ベース(小型ハビタットでは半径比、大型では高度 ~1.1〜1.9km にクランプ)で偏平な雲塊が浮かび、ゆっくり地表に対して流れます(InstancedMesh、決定論シード配置)。
- 各地表ストリップには **道路網を手続き生成** します。軸方向のアベニューと周方向のクロスストリートが街区(ブロック)を区切り、建物は各ブロックの外周に「道路に面して」並びます(ペリメーターブロック方式)。道路グリッドは構造的に決まり、建物配置だけが seed 依存です。道路は**幹線(6〜24m)と生活道路(4〜8m)の2階層**で、絶対メートルにクランプした現実的な幅です(ストリップ端+一定間隔の道路が幹線。街灯と窓を渡る橋は幹線に従います)。路面は**レーンマーキング付きのアスファルト**(幹線=白エッジライン+黄色センターライン+破線レーン線、生活=エッジラインのみ)で、UV を道路方向にベイクして実寸 12m 周期でマーキングが流れます。橋のデッキにも幹線マーキングが乗ります。スポーンのマーカーは青い看板から控えめなシアンリングの路面インレイに変更。
- 近景建物は**地区ごとの建築言語**を持ちます: 旧市街(港端)は **Kenney City Kit Commercial** のレンガ・庇付き低層(敷地へ伸縮・LODペア同梱)、郊外の戸建ては **Kenney City Kit Suburban**(ディテール保護のため等方スケール+敷地内センター=余白が庭になる)、CBD は従来の Blender 製日本キット。いずれも CC0(kenney.nl)で `public/assets/buildings/kenney/`、GLB 欠損時は日本キット→手続き生成へ自動フォールバックします。
- プレイヤー周辺(端末 Tier で 130〜240m)の路面には **Kenney City Kit (Roads) のタイルオーバーレイ**(CC0、`public/assets/roads/`、クレジット: kenney.nl)を敷きます。縁石・歩道・車線付きの直線タイルに加え、交差点はソケット照合で **十字/T字/角** を選んで回転配置し(幹線の接続部はゼブラタイル)、円筒(θ,z)ドメインに合わせて周方向の走行はサジッタが見えないピッチに分割します。塗装路面は全域の遠景 LOD 兼フォールバックとしてそのまま残り、曲率が勝つ小径ドラム(半径 300m 未満)はオーバーレイを敷きません。
- スポーン周辺 260m だけを**日本的なヒーロー街区**として扱い、生活道路に電柱・変圧器・3本のたるみ電線を追加します。全市へ展開せず、遠景での線のちらつきと Quest の描画負荷を抑えます。高架道路の箱桁下面には、連続した低ポリゴンの設備配管を1バッチで追加します。
- ヒーロー街区のうち近景 180m では、Blender 製の**店舗シャッター・ガラス店舗・自販機・室外機/配管・自転車・プランター路地**を実在する道路側の建物前だけに最大96組配置します。LOD0 と一緒に消える6バッチの InstancedMesh とし、遠景へ細物をばらまかず日本の街路密度を出します。スマホはLOD0を120m・最大96棟、LOD1を260m・最大320棟に制限します。
- **中心部と周縁部の密度勾配は意図的に極端**です。コンパクトな CBD は街区内を4重の建物列で埋め、高層化・高充填率を同時に掛けます。郊外は2〜3列、最外縁は道路沿い1列の低層だけを残し、農地率を最大78%まで上げます。道路網は連続したままなので、展望地点から「都心の塊→疎な周縁」が読めます。
- 建物LODは方位角だけでなく、周方向距離と軸方向距離を合わせた**地表2次元距離**で判定します。近景GLB、簡略GLB、手続き生成アーキタイプ、遠景箱バッチの4段階で、12%のヒステリシスと端末別インスタンス上限を持ちます。遠景の画面サイズカリングは円筒内の chord 距離と軸方向距離で判定します。
- **建物の高さは 1G 帯にクランプ**:人工重力は `g(h) = g₀(1 − h/R)` で高度とともに弱まるため、常用建築は地表近くに張り付くはずです。建物高さを最大 78m に絶対クランプし、巨大ハビタットでも表面重力の数 % 以内に収まります。大型建物は高密度の窓テクスチャを使い、窓が巨大化しません。
- **建物のバリエーション**:手続き生成側は箱 / 段状セットバック / 八角形タワー / ピラミッド屋根の低層 / ポディウム付きスラブ / L字棟を持ち、種類ごとに InstancedMesh バッチ化(壁=窓テクスチャ・屋根=無地のマテリアルグループ)。近距離では対応する Blender アーキタイプへ差し替わります。
- **多重リング配置**:街区は外周から中心へ向かう1〜4リングの建物列が路地を挟んで入れ子になり、残った中庭は緑地になります。リング数は都市化率に連動し、ストリップ使用率 94%、密度上限 12000 棟。
- **ブロック用途分け**:街区の一部は決定論的に公園(緑地+instanced の樹木)や農地(作物ストライプ)になり、住宅区はこれまで通り道路に面した建物が並びます。
- **街灯**:アベニュー沿いに暖色の灯りが等間隔に浮かびます(InstancedMesh、上限あり)。
- **展望タワー**:プラザ脇に Overlook ワープ高度のすぐ下まで届く観測塔(デッキ+アクセントリング)。歩行・ボール衝突付きで、Overlook からの落下時の視覚基準にもなります。
- **軸エレベーターケーブル**:各地表ストリップから軸スパインへ 2 本ずつケーブルが伸び、地表と軸をつなぐスケール感を出します。
- **端部キャップ**:両端開口部にリムリング+ハブリング+放射スポークのドッキング構造。中央は開いたままなので外へは出られます。
- **宇宙港(−Y端=ミラーの根本側)**:回転速度ゼロの軸でしかドッキングできない、という回転居住区の必然をそのまま景観に。軸上のハブチューブ(大型ハビタットでは内部に入れる到着ベイ+誘導灯ストリップ)、4本のドッキングアーム、人間スケール(全長18m)のシャトル2機が接舷、1機が軸に沿ってゆっくり進入してきます。ナビライトが点滅します。③Axis ワープの到着地がこの港です。
- 中心軸には発光スパイン(軸構造物)+リング構造が走り、「上を見ると反対側の街」を強調します。
- 歩行中の建物衝突は表面2D空間の解析判定(`resolveCitySurfaceCollision`)で処理し、道路は歩行可能です。ボールは回転系での球–OBB解析衝突(`collideSphereWithBuildings`)で建物に当たって跳ね返ります(屋根・側面・妻面すべて)。
- 旧・夜景エミッシブテクスチャ(Night Surface / far-field)は実建物の街に置き換えられ、撤去済みです。

## 内壁シェル描画

- `nearLayer` に近景、`skyLayer` に星空を分け、主内壁は near/far shell として描画します。`farLayer` は将来の遠景表現用 scaffold として残していますが、通常プレイでは使っていません。
- 内壁 shell には procedural の surface texture を貼っていて、約 10m 級のパネル継ぎ目と 40m 級の大区画を繰り返し表示します。アセットを増やさず、接地面の距離感を出す意図です。
- 主内壁の描画は near/far shell に分けています。プレーヤー周辺の内壁は高分割、遠方は低分割の shell にして、近景を優先しつつ遠方コストを抑えています。
- 固定物 collider は現在ほぼ使っていません。主内壁は球と `free-fly` プレーヤーの解析接触を主に使います。


## 単位ルール

- `real`: 設定、プリセット、HUD、GUI、wrist UI、描画、回転系/慣性系変換で使うメートル基準
- `sim`: Rapier world に渡す位置、速度、collider 寸法で使う物理基準
- 変換は `src/units/units.ts` と `src/physics/rapierBoundary.ts` 以外では行いません。
- `rpm / omega / period / surface g` の相互変換も `src/units/units.ts` に集約しています。

## よくあるバグ

- `simScale` を変えたら投擲だけ弱くなる/強くなる:
  throw 合成が `real` でなく `sim` に漏れている可能性があります。`bun test` の throw/units 系を確認してください。
- preset を変えたら respawn 位置だけずれる:
  Rapier pose への書き込みが boundary を通っていない可能性があります。respawn 系テストを確認してください。
- observer mode や trail が崩れる:
  回転系/慣性系の変換前に `sim` を混ぜている可能性があります。描画と frame transform は常に `real` 前提です。

## 実装済みの主な内容

- シリンダー内壁メッシュと簡易グリッド
- 内壁のランウェイ風ライン
- 開口部の外に見える夜空と、回転感を出すための外部星空の逆回転表示
- 回転座標系の人工重力とコリオリ
- 球の投擲、二重軌跡表示、30秒での自動破棄
- Rapier による球の慣性系シミュレーションと、回転する内壁への接触処理
- 球だけは開口部から外へ出られるシームレスな内外遷移
- プレイヤーの `grounded / free-fly` 状態切替、自然接触での再アタッチ、外側での Rapier ベース hand-aim jetpack 移動
- free-fly プレーヤーの `capsule + foot plate` collider
- 左手 wrist UI、右手 UI レーザー、非VR画面下のドック(HUD チップ+Travel / Spin)
- 内壁 shell の procedural texture
- 手続き生成の円筒都市(道路網+道路に面した建物、採光窓ストリップ、軸スパイン)
- `Playground / Izma / Cooper / Elysium` preset と `real / simScale` 分離
- `Surface / Overlook / Axis / Exterior` の 4 地点ワープと `Ball / Beam / Firework` の投射切替
- `colony-fixed / inertial-fixed` の observer mode
- 回転系速度差分と擬似力計算の整合を見る verification HUD
- `bun test` によるシミュレーション核の単体テスト

## License

[GNU AGPL-3.0-or-later](LICENSE) © 2026 tomingtoming.

Third-party assets and libraries keep their own licenses: the road and vehicle models are by [Kenney](https://www.kenney.nl/) (CC0, `License.txt` beside each set), [three.js](https://threejs.org/) is MIT, and [Rapier](https://rapier.rs/) is Apache-2.0.
