# VR 操作系（Spinward）

> **左手が飛ばし、右手が世界に触る。A は「上」、B は「メニュー」——両手共通。**
> *Left hand flies you, right hand touches the world; A = up, B = menu.*

Meta Quest（Touch）コントローラ前提。バインドの**単一の真実**は
[`src/xr/controlScheme.ts`](../src/xr/controlScheme.ts) にある。本書・アプリ内の手首
「Controls」ページ・HUD の controls ドロワーはすべてそこから生成されるので、互いに
食い違わない。

## 設計原則

1. **左手＝自己移動、右手＝世界操作。**
2. **A/B は両手で同じ意味**（A＝上、B＝メニュー）。「左で A はブレーキ、右で A はジャンプ」
   のような取り違えを構造的に排除。
3. **主移動は 1 モード 1 経路**にして迷わせない。
4. **既存 VR の作法に乗る**（右スティック snap turn・トリガー＝掴む/使う・グリップ＝握る）。

## バインド表

### ON FOOT（grounded）

| 入力 | 動作 |
| --- | --- |
| L Stick | 歩く（頭基準） |
| R Stick | 左右: スナップターン ±30° / 上下フリック: 投射物切替 |
| L Grip | クラッチ（壁を掴んで登る／引き寄せ） |
| A（左右どちらでも） | ジャンプ → 飛行へ |
| R Trigger | 掴む／投げる（空撃ちで球生成・車に乗る・watch UI クリック） |
| R B | トラベル（地表 → 展望 → 軸） |
| L B | リセンター（視線を正面へ） |

### FLYING（free-fly）

| 入力 | 動作 |
| --- | --- |
| L Trigger | スラスト（左コントローラの指す方向へ、アナログ・スロットル） |
| L Stick | ストレイフ／上下スラスト |
| A（左右どちらでも） | 上昇（長押し） |
| L Grip | 停止（アナログのブレーキ） |
| R Stick | 左右: スナップターン（ヨー） / 上下フリック: 投射物切替 |
| R Trigger | 掴む／投げる |
| R B | トラベル |
| （接触） | 内壁へ低速で触れると自動で grounded に戻る |

### DRIVING

| 入力 | 動作 |
| --- | --- |
| L Stick | アクセル（前後）／ステア（左右） |
| Grip（どちらでも） | ブレーキ |
| R A | 降車 |
| R Stick | 視点（スナップ） |

## 重要な挙動

### 「停止（L Grip）」は直線ドリフトのみ止める — 角速度 ω は保持する

free-fly はリムから飛び降りた人の物理を再現していて、離脱時に体の角速度 ω
（＝コロニーの自転速度）をシードして保持し続ける
（`vrLocomotion.captureFreeFlyInertialOrientation` → `freeFlyJetpack.seedJetpackAttitudeFromWorldAngularVelocity`）。
この ω があるおかげで、視界の中でコロニーは回らず安定し、星空だけが回り続ける——
実際にリムを飛び降りた人が見る景色そのもの。

L Grip の「停止」は **慣性速度（ドリフト）だけ** を指数減衰させ、ω は殺さない
（`freeFlyBrake` → `playerTraversal.stepFreeFlyPlayer`）。ω まで殺すとコロニーが視界で
回り始めて逆に酔うため、既定では保持する。

> 「コロニーを意図的に回す（自分を慣性系に姿勢固定する）視点」が欲しい場合は、ω を
> 減衰させるデスピンを将来 settings トグルとして追加できる。現状は未提供。

### 離陸・着陸はモードレス

- **離陸**：A（ジャンプ）でのみ free-fly へ。クラッチで手を持ち上げて離陸する旧
  lift-launch は **既定 OFF**（`VRLocomotion.setLiftLaunchEnabled(true)` で復活可）。
- **着陸**：内壁へ低速で触れると自動で grounded へ。明示的な着陸ボタンは無い。

### スナップターンは両モードで右スティック

grounded ではヨーリグを、free-fly では姿勢クォータニオン自体を 1 ステップ回す。
旧仕様の「snap turn は grounded のみ」は撤廃した。

## 発見性（フィードバック）

操作が「伝わる」ように、サイレントに適用するのではなく体と耳に返す。

- **モード遷移の合図**：grounded ↔ free-fly の切替で「FREE-FLY / GROUNDED」を一瞬
  フラッシュ（`tourGuide` の再発火カード）＋振動＋`audio.playModeChange()`。リッチな
  初回チュートリアルカードが出ている間は潰さない。
- **連続フィードバック**：`audio.setJetpackThrottle()` の持続ジェット音（スロットルで
  音量と明るさが変化）＋スロットル／ブレーキ量に比例した左手の振動＋スナップ時の
  右手チック（`audio.playClick()`）。
- **手首の常設凡例**：左手首 watch UI の **Controls** ページに上記バインド表が出る
  （受動表示・`controlScheme` から描画）。home 画面の `Controls` ボタンから開く。

## 実装の所在（開発者向け）

| 何 | どこ |
| --- | --- |
| バインド定数＋ラベルの単一の真実 | `src/xr/controlScheme.ts`（`XR_BUTTON`, `VR_CONTROL_LEGEND`） |
| ロコモーション／姿勢／クラッチ／feedback 公開 | `src/xr/vrLocomotion.ts` |
| ボタンエッジ（jump＝両手 A・leftMenu＝左 B・travel＝右 B・grab） | `src/xr/xrInputMap.ts` |
| 配線（モード合図・連続フィードバック・recenter） | `src/app/main.ts` |
| モード遷移カード | `src/app/tourGuide.ts` |
| 合成音 | `src/app/audio.ts` |
| 手首凡例の描画 | `src/ui/watch/watchRenderer.ts`（`drawLegend`） |

XR-standard ボタン番号：`trigger=0 / grip=1 / A=4 / B=5`（`XR_BUTTON`）。スティック軸は
`readPrimaryStick` が大きい方のペア（`axes[0..1]` または `axes[2..3]`）を採る。

## 関連

- 物理モデル（慣性系シミュレーション・回転座標系の表示変換・着地ハンドオフ）は
  README の冒頭と `src/sim/` / `src/app/playerTraversal.ts` を参照。
- PC / スマホの操作対応は [README の「操作」](../README.md#操作主要) を参照。
