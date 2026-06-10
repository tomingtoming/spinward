# Inertial Worlds

**回転居住区の人工重力を、説明ではなく身体で理解する WebXR デモ。**
A WebXR experiment in rotating habitats.

見上げると反対側の街が空にある。歩くと普通の街なのに、投げる・跳ぶ・中心軸へ行くと物理が変になる——回転コロニーの「景観」と「人工重力の違和感」を 3 分で体験することを狙った、SF 好き向けの物理実験型 VR デモです。

`vite + typescript + three.js + rapier` で構成し、Meta Quest のブラウザと PC ブラウザの両方で動きます。Rapier の慣性系シミュレーションと回転座標系の表示変換を分離したまま、「投げると曲がる(コリオリ)」「ジャンプすると床が迎えに来る」「軸に近づくと重力が抜ける」「回転速度を変えると世界が軽くなる」を体験できます。

## 3分体験の流れ

1. **地表(Surface)** — 円筒内壁の街に立つ。空の向こうに反対側の街、採光窓のストライプ、中心軸の光が見える。
2. **投げる・跳ぶ** — ボールは真っすぐ飛ばない。ジャンプ中は何にも引かれず、床が横にずれて迎えに来る。説明カードが画面下に短く出ます。
3. **展望地点(Overlook)** — `2` キーまたは wrist UI の Travel から。軸に近いほど回転速度が遅く「重力」が弱い。落下すると街が横へ流れていく。
4. **中心軸(Axis)** — `3` キーで軸端へ。回転半径ゼロ=無重量。街が空になる。
5. **回転速度を変える** — wrist UI / quick panel の RPM で `g = ω²R` を体感する。

## 操作(主要)

| 操作 | PC | Quest | スマホ |
| --- | --- | --- | --- |
| 移動 | WASD | 左 grip クラッチ | —(ワープで移動) |
| 視線 | 右ドラッグ / 矢印キー | 頭 + 右スティック snap turn | ドラッグ / Gyro ボタンでジャイロ |
| 投げる | 左クリック | 右トリガー(チャージ可) | タップ |
| ジャンプ | Space | 右手 A ボタン | Jump ボタン |
| ワープ | 1 / 2 / 3(地表 / 展望 / 軸) | wrist UI の Travel | ① ② ③ ボタン |
| メニュー | Tab | 左手首の watch UI | — |
| 離陸(free-fly) | F | 左手を外向きへ持ち上げ | — |

スマホはタッチデバイス検出時のみ画面下にボタン列が出ます。iOS ではジャイロ使用時に Gyro ボタンから許可ダイアログが出ます。

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

## Quest での注意

- WebXR の `immersive-vr` は HTTPS が必要です。
- Vite の開発サーバーは自己署名証明書なので、Quest 側で証明書警告が出る場合があります。
- 確実に VR ボタンを有効化したいなら、`dist/` を有効な HTTPS 証明書を持つホスティングに配置してください。

## 操作

- VR: 右手だけが球生成と投擲を担当します。何もない空間で右トリガーを引くと手元に球を生成し、そのまま掴みます。
- VR: 左 grip を押している間が locomotion clutch です。手元に出る小さな軸とラインが、今の相対入力を示します。
- VR: `attached` 中は、左 grip を握ったまま手を壁面に沿って動かすか、左スティックを倒すと歩行します。手首を左右へひねると yaw で向きを変えられます。手を壁法線の外向きへ約 30cm 強く持ち上げると、そのまま `free-fly` へ離陸します。
- VR: `free-fly` 中は、左 grip を握ったまま手を前後左右上下へずらすか、左スティックを倒すと、その方向へ推進します。手首の pitch / yaw / roll 差分はそのまま回転入力になります。
- VR: `free-fly` 中は左 `X` で回転 brake、左 `Y` で平行移動 brake を掛けられます。
- VR: 左手首には wrist UI が常時表示されます。右手レーザーで狙い、右トリガーで `rpm / radius / throw / jetpack / reattach` を変更できます。
- VR: wrist UI / PC quick panel / GUI から `jetpack thrust` も調整できます。
- VR: wrist UI から `Playground / Izma / Cooper / Elysium` preset を即時適用できます。適用時は habitat と Rapier scale を再構築し、球をクリアして内壁中央へ respawn します。
- VR: wrist UI の Travel から `Surface / Overlook / Axis` の 3 地点へワープできます。
- VR: wrist UI は `-- / - / + / ++` の 4 ボタンで fine/coarse を分けています。`rpm` は 3 桁有効、`radius` は大きな habitat でも有効桁ベースで step が自動で変わります。
- VR: 右スティック左右の `snap turn` は `attached` 中だけ有効です。`free-fly` では右手を投擲や UI へ残します。
- VR: 球のトリガーを離すと放します。投げ速度は右手の相対運動と前方チャージから決めます。
- VR: 球はトリガー長押しで前方チャージされ、短押しではプレーヤーに対して相対速度 0 から始まります。
- VR: 球を握っている間は、チャージ量に応じて色がオレンジから水色へ変わります。
- VR/PC: 球は建物に当たると跳ね返ります(建物は回転系で静止しているので、回転系の相対速度で反射します)。
- VR/PC: 球はシリンダー開口部から外へ抜けられます。
- VR/PC: プレイヤーも端で止まらず、そのまま開口部の外へ出られます。
- VR/PC: `free-fly` 中でも、内壁へ低速で戻れば自然接触で `attached` に戻ります。
- VR/PC: `free-fly` 中は、最寄りの内壁ドッキング位置へ伸びる in-world guide が出ます。`ready` で緑、それ以外は青です。
- PC: キャンバス左クリックで球を前方へ投げます。
- PC: `Space` でジャンプします。空中では何も引かないので、床のほうが曲がって迎えに来ます。着地すると自動で `attached` に戻ります。
- PC: `1 / 2 / 3` で 地表 / 展望地点 / 軸端 へワープします。
- PC: `F` で壁から離陸して `free-fly` に入れます。
- PC: 内壁にいる間は `WASD` で歩行し、外では視線方向へ jetpack 移動します。
- PC: `Shift` で `free-fly` の平行移動 brake を掛けられます。
- PC: 右ドラッグまたは矢印キーで視線を回せます。
- PC: `Tab` で左下の quick panel を開閉し、クリックで wrist UI と同じ設定、preset、respawn を操作できます。
- GUI: `radius`, `rpm`, `surface g`, `span`, `simScale`, `preset`, `throw scale`, `jetpack`, `reattach` 閾値を右上で確認/調整できます。
- GUI: `observer` で `colony-fixed / inertial-fixed` を切り替えられます。`inertial-fixed` は現在 PC 向けで、XR 中は自動で `colony-fixed` に戻ります。
- GUI: `trail mode` で `Rotating / Inertial / Both` を切り替えられます。
- GUI: `frame err` は回転系速度差分から見積もった加速度と、擬似力計算のズレ警告しきい値です。
- HUD: `free-fly` 中は再アタッチ用の半径誤差、法線速度、壁相対速度、`ready/hold` を確認できます。
- HUD: 追跡球について `v_inertial`, `v_rot`, `a_fictitious`, `a_rot_est`, `err` を表示します。誤差がしきい値を超えると `Frame mismatch!` を出します。
- 左手は locomotion 専用で、球生成と投擲は右手に集約しています。

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
- 単位変換は [src/units/units.ts](/home/toming/xr1/src/units/units.ts) 経由のみです。
- Rapier との境界は [src/physics/rapierBoundary.ts](/home/toming/xr1/src/physics/rapierBoundary.ts) へ集約しています。
- runtime 側では raw `simScale` を直接ばら撒かず、`UnitsContext` を生成して boundary API へ渡します。
- 球と `free-fly` プレイヤーの内部状態は慣性系で保持し、描画時に回転系へ戻しています。
- `attached` プレイヤーだけは内壁拘束ロジックを使います。
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

## Travel(ワープ 3 地点)

- `Surface`: 円筒中央の内壁プラザへ戻り、`attached` で開始します。
- `Overlook`: プラザ上空(半径の 1/2、8〜60m にクランプ)へ共回転状態で出ます。弱い遠心「重力」でゆっくり落下し、着地すると自動で `attached` に戻ります。
- `Axis`: cylinder では円筒端の回転軸上、ring ではリング中心へ戻り、`free-fly` 0g で開始します。

## Cityscape(円筒都市)

- O'Neill 型に 3 本の地表ストリップと 3 本の採光窓ストリップを交互配置し、スポーン地点周辺はプラザとして空けています。
- **採光窓は本物の開口**です。内壁シェルから窓の円弧を切り抜き(`subtractArcIntervals`)、窓越しに星空と、外側に開いた 3 枚の**太陽ミラー**(パネル継ぎ目入りの反射グラデーション)が見えます。シェルの高分割アークは量子化したフォーカス角で再構築し、UV は絶対角度でベイクするので継ぎ目なくグリッドが続きます。
- **太陽光は窓から差します**。窓の中心方位から内向きの DirectionalLight ×3(コロニー固定)で、建物に窓由来の陰影がつきます。
- **建物は側面に窓明かりテクスチャ**(emissiveMap、屋根は無地)を持ち、夜の街区が自然に光ります。
- **エアロパースペクティブ**:`FogExp2` を半径連動の濃度で適用し、反対側の街が霞みます(星空・ミラーは fog 対象外)。レンダラは ACES Filmic トーンマッピング。
- 各地表ストリップには **道路網を手続き生成** します。軸方向のアベニューと周方向のクロスストリートが街区(ブロック)を区切り、建物は各ブロックの外周に「道路に面して」並びます(ペリメーターブロック方式)。道路グリッドは構造的に決まり、建物配置だけが seed 依存です。
- 建物は単一の InstancedMesh(1 draw call、上限 2400 棟)、道路はマージ済みの円弧バンド 1 メッシュで描画します。クロスストリートは円筒に沿って曲がるため、平面ではなく円弧ジオメトリを使っています。
- **ブロック用途分け**:街区の一部は決定論的に公園(緑地+instanced の樹木)や農地(作物ストライプ)になり、住宅区はこれまで通り道路に面した建物が並びます。
- **街灯**:アベニュー沿いに暖色の灯りが等間隔に浮かびます(InstancedMesh、上限あり)。
- **展望タワー**:プラザ脇に Overlook ワープ高度のすぐ下まで届く観測塔(デッキ+アクセントリング)。歩行・ボール衝突付きで、Overlook からの落下時の視覚基準にもなります。
- **軸エレベーターケーブル**:各地表ストリップから軸スパインへ 2 本ずつケーブルが伸び、地表と軸をつなぐスケール感を出します。
- **端部キャップ**:両端開口部にリムリング+ハブリング+放射スポークのドッキング構造。中央は開いたままなので外へは出られます。
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
- プレイヤーの `attached / free-fly` 状態切替、自然接触での再アタッチ、外側での Rapier ベース hand-aim jetpack 移動
- free-fly プレーヤーの `capsule + foot plate` collider
- 左手 wrist UI、右手 UI レーザー、PC quick panel
- 内壁 shell の procedural texture
- 手続き生成の円筒都市(道路網+道路に面した建物、採光窓ストリップ、軸スパイン)
- `Playground / Izma / Cooper / Elysium` preset と `real / simScale` 分離
- `Surface / Overlook / Axis` の 3 地点ワープ
- `colony-fixed / inertial-fixed` の observer mode
- 回転系速度差分と擬似力計算の整合を見る verification HUD
- `bun test` によるシミュレーション核の単体テスト
