# 遠景 LOD と大気ヘイズ（Spinward）

> **遠くの街は幾何をやめて、色と光と霞になる。近づけば逆順に戻ってくる。**
> *Distant city resolves into color, light and haze; approach it and it climbs back up the chain.*

O'Neill シリンダーには地平線がなく、対岸 6.4km までの全都市が常に視界にある。
「景観 vs Quest 性能」は原理的トレードオフではなく、**中景のテクスチャ表現と
遠景の大気表現が未実装**なだけ——というのが 2026-07-22 の実測（Android/Adreno、
`?stats`+`?tier`+`?depth`）で固まった結論。本書はその実装設計。

## 設計原則

1. **視角駆動。** 絶対距離ではなくスクリーン上のピクセルで段を決める。
   Quest 3 ≈ 25px/度 での目安（高さ 7m の郊外戸建て）:

   | 距離 | 画面上の高さ | 求められる表現 |
   | --- | --- | --- |
   | 120m | ≈ 84px | 幾何（kit フル形状） |
   | 300m | ≈ 33px | テクスチャ（窓のリズムが読める） |
   | 1km | ≈ 10px | 色と光の分布 |
   | 3.2km（軸から全島） | ≈ 2.2px | 色場のみ |
   | 6.4km(2R)（対岸） | ≈ 1.5px | 色場のみ |

2. **分業。** 近景 = 幾何の仕事／遠景 = 色場・夜光の分布・大気減衰の仕事（ほぼタダ）。
   戦場は両者が重なる**中景 120–500m のみ**。
3. **方向でなく距離で決める（飛行整合）。** 「対岸を焼く」という方向ベースの発想は
   free-fly で破綻する（軸上では全島が等距離 3.2km、降下すればどの島にも近づける）。
   全ての段は視角閾値で入れ替わり、接近すればチェーンを逆順に登る。軸上は
   全方位 2.2px なので「全部が終端段」でよい最良ケース。
4. **物理から導く。** ヘイズは演出ではなく閉鎖大気の帰結。回転大気の圧力勾配は
   Izma 規模（R=3.2km, 1g）で軸/殻 ≈ 0.83 と穏やかなので一様密度近似は正当。
   むしろ現状の `AIR_FOG_DENSITY = 1e-4`（6.4km 透過 ≈ 53%）は視程数十 km 相当で、
   湿潤な閉鎖大気としては「クリアすぎる嘘」の側にいる。
5. **消えるな、退化しろ。** 現状 `farMinAngularSize` 未満の建物は CPU 側で
   インスタンス配列から除外＝**遠景に穴が開いている**。終端段（殻焼き込み）は
   この穴に質量を返す純増であり、何も犠牲にしない。

## 三段チェーン

```
[段1] kit フル形状 (LOD0/LOD1)          … 幾何
   ↓ 視角閾値（≈ 33px 帯）
[段2] 調和箱 + ファサードアトラス        … テクスチャ
   ↓ 視角閾値（farMinAngularSize ≈ 6px）
[段3] 殻焼き込み（シリンダー内面テクスチャ）… 色場 + 夜光
```

### 段1 — 近景 kit（現状 + PR#80）

現状の LOD0/LOD1/procedural 3 層（`buildingLod.ts` のヒステリシス付きブレンド +
`aLodDither` スクリーンドア遷移）をそのまま使う。PR#80 で Kenney 統一・
`lod1FullKitGeometry` knob（Quest/phone は LOD0 外を調和箱へ直行）が入る。

### 段2 — 中景ファサードアトラス箱（PR#80 依存）

- Kenney 各変種を**一度だけオフラインで小アトラスに焼く**: 壁面・屋根・
  夜窓 emissive の 3 チャンネル。33px 帯では窓のリズムはテクスチャで本物に見える。
- far batch の箱（現状 `instanceColor` 単色 + 共有屋根テクスチャ）に変種対応の
  UV オフセットを per-instance 属性で与え、アトラスを参照させる。
- 夜窓 emissive も同アトラスから引くことで、近景（kit の窓明かり）と夜景の光が
  全距離で連続する。

### 段3 — 殻焼き込み（PR#80 と弱依存）

- `cylinderSurface.ts` は既に Canvas2D で地面・船体・端キャップ・窓ガラスの
  albedo/emissive を手続き焼きしている。**ここに `cityLayout` から街区を描き込む**:
  道路網の淡い格子・街区の色むら（albedo）＋夜窓ノイズ（emissive）。
- 昼夜: 殻マテリアルに emissiveMap を追加し、`dayNightPhase` →
  `emissiveIntensity` で駆動（`setDaylight` と同型の配線）。
- 解像度予算: 段3 は **2–3km 以遠専任**とし、1 texel / 2–3m で足りる
  （land 3 帯 ≈ 10km 周 × 40km 長でも数 k × 数 k の Canvas に収まる）。
  スワップを 1km まで粘ると 1 texel/m 級が要って破綻するので、
  段2 の箱をやや遠くまで引っ張る配分にする。
- 生成タイミングは都市生成直後に一度（CPU・Canvas2D）。ランタイムコスト無し。

## 大気ヘイズ（増強）

- 現状: `FogExp2(0x5f7587, 1e-4)` × `getAirColumnFraction` × 雨補正
  （`main.ts` の一箇所で毎フレーム更新、色は `skyGrade.fog`）。
- 変更: 密度の基準値を**視程パラメータ**（メートル）として持ち直し、
  tier 別に設定可能にする（`QualityProfile` へ）。Quest だけ濃くしても
  「性能の言い訳」ではなく物理表現の範囲——6.4km 先が霞むのは嘘ではない。
- 段2↔段3 のスワップ距離帯で fog 透過率が十分下がるよう視程を選ぶ
  （スワップのポップはヘイズが天然のマスクになる）。
- 降下中は視線が濃い層を長く通る＝接近ほど霞むのは物理と整合し、
  ストリーミング・インの時間稼ぎとしても働く。
- `fog: false` の材質（太陽・大気グロー Sprite、ヘリオスタット）は意図的に
  fog の外。道路の `installDistanceFade` は二段目のフェードとして既存のまま。

## 実装スライス（PR 分割と依存）

| スライス | 依存 | 内容 |
| --- | --- | --- |
| ① ヘイズ増強 | なし（main に直） | 視程パラメータ化・tier 別値・`?debug` チューニング枠 |
| ② 殻焼き込み | PR#80 と弱衝突（`cityLayout` API を消費） | `cylinderSurface` 拡張 + emissiveMap + 昼夜駆動 |
| ③ 中景アトラス | PR#80 merge 後 | オフラインアトラス焼き + far batch の UV 属性 + 夜窓 |

推奨順: **PR#80 merge → ① → ② → ③**（①のみ #80 前でも安全に着手可）。

## 実測の裏付け（2026-07-22, Android/Adreno 実機）

- log 深度の early-Z 税 ≈ 3ms/フレーム ≈ 10%（LOG 35fps vs PLAIN 39fps、
  同一地点・150 draws・636k tris・`?tier=desktop`）→ **log 継続裁定**。
  10% は Quest の 20fps を救わない＝本丸は tris/LOD 側という本書の前提を実測が支持。
- plain の z-fight 明滅は**頭上の対岸**（6.4km ＝ plain 深度精度の死に場所）で
  強まることを目視確認 → 遠景を「薄い幾何の重なり」でなく色場+テクスチャで
  作る方針は、深度精度の観点でも正しい側にいる。

## 実装の所在（開発者向け）

| 何 | どこ |
| --- | --- |
| fog 本体・毎フレーム更新 | `src/app/main.ts`（`AIR_FOG_DENSITY`、`fog.density` 更新部） |
| 空のグレーディング（fog 色の源） | `src/app/skyGrade.ts` `sampleSkyGrade` |
| 昼夜位相 | `src/app/dayNight.ts`（`dayNightPhase` は `main.ts` ローカル） |
| 大気モデル | `src/sim/habitatConfig.ts` `getAtmosphereDepth` / `getAirColumnFraction` |
| 殻テクスチャ手続き焼き | `src/objects/cylinderSurface.ts`（Canvas2D albedo/emissive） |
| 殻マテリアル・UV | `src/objects/cylinder.ts` `nearShellMaterial` / `farShellMaterial` |
| 窓帯の大気シェーダ（fog 別経路） | `src/objects/cylinder.ts` `hazeMaterial`（`setAtmosphere` で同期） |
| far batch（調和箱）と視角カリング | `src/objects/cityscape.ts` `updateFarBatch`（`farMinAngularSize`） |
| LOD ブレンド純関数 | `src/objects/buildingLod.ts` |
| tier 別予算 | `src/app/quality.ts` `QualityProfile`（`?tier=` で強制可） |
| 計測 | `?stats`（fps チップ）+ `?depth=log\|plain`（深度 A/B） |

## 関連

- [VR 操作系](vr-controls.md)
- 深度戦略の経緯: PR [#78](https://github.com/tomingtoming/spinward/pull/78)（A/B 装備）
  → PR [#81](https://github.com/tomingtoming/spinward/pull/81) / [#82](https://github.com/tomingtoming/spinward/pull/82)（計測装備）→ log 継続裁定（本書「実測の裏付け」）
- 景観リアリティ 16 コミット: PR [#80](https://github.com/tomingtoming/spinward/pull/80)
- reversed-Z の観測ポイント（three r185+ WebGPU-XR / Quest ブラウザ binding /
  WebGPURenderer への移植）が揃えば early-Z + z-fight ゼロが解禁され、
  本書のヘイズ・アトラスはそのまま画質側の資産として残る。
