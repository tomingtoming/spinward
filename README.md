# O’Neill Cylinder Playground

Meta Quest 3S のブラウザで開けるように、`vite + typescript + three.js` で WebXR playground を構成しています。現在は Sprint 2 段階で、Rapier の慣性系シミュレーションと、回転座標系の表示変換を分けたまま「投げると曲がる」と「慣性系では直線に近い」を見比べられます。

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
- GUI: `radius`, `rpm`, `throw scale`, `surface g`, `reattach` 閾値と弱い landing assist の強さを右上で調整できます。
- GUI: `observer` で `colony-fixed / inertial-fixed` を切り替えられます。`inertial-fixed` は現在 PC 向けで、XR 中は自動で `colony-fixed` に戻ります。
- GUI: `trail mode` で `Rotating / Inertial / Both` を切り替えられます。
- GUI: `frame err` は回転系速度差分から見積もった加速度と、擬似力計算のズレ警告しきい値です。
- HUD: `free-fly` 中は再アタッチ用の半径誤差、法線速度、壁相対速度、`assist/coast`, `ready/hold` を確認できます。
- HUD: 追跡球について `v_inertial`, `v_rot`, `a_fictitious`, `a_rot_est`, `err` を表示します。誤差がしきい値を超えると `Frame mismatch!` を出します。
- landing assist は弱く入っているだけなので、壁相対速度が高いままだと再アタッチせず、そのまま滑るか跳ね返ります。
- `free-fly` 中の左トリガーは jetpack 優先なので、左手の空中トリガーで球は生成しません。右手側の投擲はそのまま使えます。

## 座標系と式

- シリンダー中心軸と長手方向は `+Y`、半径方向は `XZ` 平面です。
- 角速度ベクトルは `Ω = (0, ω, 0)` です。
- 人工重力の目安は `g = ω^2 R` です。
- Rapier world は慣性系で動かしています。
- 回転座標系は表示、入力解釈、デバッグ可視化のための変換層です。
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

## 実装済みの主な内容

- シリンダー内壁メッシュと簡易グリッド
- 内壁のランウェイ風ラインと簡易エアロック表示
- 開口部の外に見える夜空と、回転感を出すための外部星空の逆回転表示
- 回転座標系の人工重力とコリオリ
- 球の投擲、二重軌跡表示、30秒での自動破棄
- Rapier による球の慣性系シミュレーションと、回転する内壁への接触処理
- 球だけは開口部から外へ出られるシームレスな内外遷移
- プレイヤーの `attached / free-fly` 状態切替、自然接触での再アタッチ、外側での Rapier ベース hand-aim jetpack 移動
- `colony-fixed / inertial-fixed` の observer mode
- 回転系速度差分と擬似力計算の整合を見る verification HUD
- `bun test` によるシミュレーション核の単体テスト
