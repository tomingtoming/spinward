# O’Neill Cylinder Playground

Meta Quest 3S のブラウザで開けるように、`vite + typescript + three.js` で WebXR playground を構成しています。現在は Sprint 2 段階で、Rapier の慣性系シミュレーションと、回転座標系の表示変換を分けたまま「投げると曲がる」と「慣性系では直線に近い」を見比べられます。Habitat preset、Respawn、`real` と `simScale` の分離まで実装済みです。

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

- VR: 何もない空間でトリガーを引くと手元に球を生成し、そのまま掴みます。
- VR: 左右の手は独立しているので、同時に別々の球を持って投げられます。
- VR: 内壁にいる間は左スティックで歩行します。
- VR: 内壁にいる間でも左トリガーで壁から離陸して `free-fly` に入れます。
- VR: `free-fly` 中は左トリガーで左手の向きへ加速します。
- VR: `free-fly` 中は左スティック押し込みで平行移動 brake を掛け、ドッキング前に速度を落とせます。
- VR: `free-fly` 中は左スティック左右でロール角速度、前後でピッチ角速度を与えます。
- VR: `free-fly` 中は左 grip で回転 brake を掛け、現在の角速度を徐々に落とせます。
- VR: 左手首には wrist UI が常時表示されます。右手レーザーで狙い、右トリガーで `rpm / radius / throw / landing assist / reattach` を変更できます。
- VR: wrist UI / PC quick panel / GUI から `jetpack thrust` も調整できます。
- VR: wrist UI から `Night Surface` の `on/off`, `day/night/auto`, `intensity` を変更できます。内壁 shell 自体の発光と twinkle に効きます。
- VR: wrist UI から `Izma / Cooper / Elysium` preset を即時適用できます。適用時は habitat と Rapier scale を再構築し、球をクリアして内壁中央へ respawn します。
- VR: wrist UI から `Respawn: Inner Wall` と `Respawn: Axis End` を呼べます。`Axis End` は cylinder のみで、ring preset では disabled です。
- VR: wrist UI は `-- / - / + / ++` の 4 ボタンで fine/coarse を分けています。`rpm` は 3 桁有効、`radius` は大きな habitat でも有効桁ベースで step が自動で変わります。
- VR: 右スティック左右で `snap turn` できます。
- VR: 球のトリガーを離すと放します。球はその時のコントローラ速度から投げ速度を決めます。
- VR: 球はトリガー長押しで前方チャージされ、短押しではプレーヤーに対して相対速度 0 から始まります。
- VR: 球を握っている間は、チャージ量に応じて色がオレンジから水色へ変わります。
- VR/PC: 球はシリンダー開口部から外へ抜けられます。
- VR/PC: プレイヤーも端で止まらず、そのまま開口部の外へ出られます。
- VR/PC: `free-fly` 中でも、内壁へ低速で戻れば自然接触で `attached` に戻ります。
- VR/PC: `free-fly` 中は、最寄りの内壁ドッキング位置へ伸びる in-world guide が出ます。`ready` で緑、landing assist 中は橙、それ以外は青です。
- PC: `Space` またはキャンバス左クリックで球を前方へ投げます。
- PC: `F` で壁から離陸して `free-fly` に入れます。
- PC: 内壁にいる間は `WASD` で歩行し、外では視線方向へ jetpack 移動します。
- PC: `Shift` で `free-fly` の平行移動 brake を掛けられます。
- PC: 右ドラッグまたは矢印キーで視線を回せます。
- PC: `Tab` で左下の quick panel を開閉し、クリックで wrist UI と同じ設定、preset、respawn を操作できます。
- PC: quick panel でも `Night Surface` の `on/off`, `mode`, `intensity` を同じ設定ソースで操作できます。
- GUI: `radius`, `rpm`, `surface g`, `span`, `simScale`, `preset`, `throw scale`, `reattach` 閾値、弱い landing assist、Night Surface の詳細パラメータを右上で確認/調整できます。
- GUI: `observer` で `colony-fixed / inertial-fixed` を切り替えられます。`inertial-fixed` は現在 PC 向けで、XR 中は自動で `colony-fixed` に戻ります。
- GUI: `trail mode` で `Rotating / Inertial / Both` を切り替えられます。
- GUI: `frame err` は回転系速度差分から見積もった加速度と、擬似力計算のズレ警告しきい値です。
- GUI: `wall sectors` を有効にすると、現在 Rapier の主内壁 collider が active な近傍 sector をシアン帯で可視化できます。
- HUD: `free-fly` 中は再アタッチ用の半径誤差、法線速度、壁相対速度、`assist/coast`, `ready/hold` を確認できます。
- HUD: 追跡球について `v_inertial`, `v_rot`, `a_fictitious`, `a_rot_est`, `err` を表示します。誤差がしきい値を超えると `Frame mismatch!` を出します。
- HUD: `wall viz active/total` で、主内壁 streaming collider の現在 active な sector 数を確認できます。
- landing assist は弱く入っているだけなので、壁相対速度が高いままだと再アタッチせず、そのまま滑るか跳ね返ります。
- `free-fly` 中の左トリガーは jetpack 優先なので、左手の空中トリガーで球は生成しません。右手側の投擲はそのまま使えます。

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

- Izma Colony: 半径 `3200m`, 全長 `40000m`, 周期 `113.5s`, `0.5286rpm`, `simScale 0.02`
- Cooper Station: 半径 `3200m`, 全長 `32000m`, `0.5rpm`, `simScale 0.02`
- Elysium: 半径 `30000m`, リング厚み `2000m`, 周期 `348s`, `0.1724rpm`, `simScale 0.005`
- Elysium は現在の traversal と collider を保つため、見た目と接触は「短い axial band を持つ ring 近似」として扱っています。

## Respawn

- `Inner Wall`: 円筒中央の内壁へ戻り、`attached` で開始します。
- `Axis End`: 円筒端の回転軸上へ戻り、`free-fly` で開始します。
- `Axis End` は cylinder preset のみ有効です。ring preset では disabled になります。

## Night Surface

- 現在の runtime では、上空の別帯 night city は使わず、内壁 shell 自体に夜景発光を持たせています。
- `nearLayer` に近景、`skyLayer` に星空を分け、主内壁は near/far shell として描画します。`farLayer` は将来の遠景表現用 scaffold として残していますが、通常プレイでは使っていません。
- Night では inner wall の emissive texture が光り、Day では発光を止めます。`Auto` は preset に応じて Izma/Cooper を夜、Elysium を昼へ寄せています。
- `intensity` と `density` は内壁の窓明かり量に効き、`twinkle (s)` は emissive pattern の更新間隔です。
- 大きい habitat では opposite wall の夜景が潰れないよう、night emissive だけは地面 texture より粗い district-scale repeat と visibility boost を使っています。
- 内壁 shell には procedural の surface texture を貼っていて、約 10m 級のパネル継ぎ目と 40m 級の大区画を繰り返し表示します。アセットを増やさず、接地面の距離感を出す意図です。
- 固定物 collider は別設計です。主内壁は解析接触と Rapier 補助で扱い、airlock などの固定物は「プレーヤーと球の近傍 sector だけ有効化する streaming collider」で扱います。
- 主内壁の Rapier 補助 wall も全周固定ではなく、プレーヤーと球の近傍 azimuth sector だけ高密度 panel を有効化します。大半径 preset でも接触法線の荒さを抑える意図です。
- 主内壁の描画も near/far shell に分けています。プレーヤー周辺の内壁は高分割、遠方は低分割の shell にして、近景を優先しつつ遠方コストを抑えています。

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
- Night Surface の見え方だけ崩れる:
  shell lighting の repaint が走っていない可能性があります。cylinder surface / preset 系テストを確認してください。
- observer mode や trail が崩れる:
  回転系/慣性系の変換前に `sim` を混ぜている可能性があります。描画と frame transform は常に `real` 前提です。

## 実装済みの主な内容

- シリンダー内壁メッシュと簡易グリッド
- 内壁のランウェイ風ラインと簡易エアロック表示
- 開口部の外に見える夜空と、回転感を出すための外部星空の逆回転表示
- 回転座標系の人工重力とコリオリ
- 球の投擲、二重軌跡表示、30秒での自動破棄
- Rapier による球の慣性系シミュレーションと、回転する内壁への接触処理
- 球だけは開口部から外へ出られるシームレスな内外遷移
- プレイヤーの `attached / free-fly` 状態切替、自然接触での再アタッチ、外側での Rapier ベース hand-aim jetpack 移動
- free-fly プレーヤーの `capsule + foot plate` collider
- 左手 wrist UI、右手 UI レーザー、PC quick panel
- 内壁 shell の procedural texture と night surface emissive
- 固定物用の近傍 streaming collider scaffold（現在は airlock 周辺）
- 主内壁の近傍 streaming wall collider
- `Izma / Cooper / Elysium` preset と `real / simScale` 分離
- 内壁中央 / 軸端の 2 種 respawn
- `colony-fixed / inertial-fixed` の observer mode
- 回転系速度差分と擬似力計算の整合を見る verification HUD
- `bun test` によるシミュレーション核の単体テスト
