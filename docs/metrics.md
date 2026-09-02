# metrics ── 「3分体験のどこまで来たか」を数える

> ステータス: **導入（2026-09-02）**。
> 実装: [`src/app/metrics.ts`](../src/app/metrics.ts) → `POST /metric`（[`worker/index.ts`](../worker/index.ts) `metric()`）→ Workers Analytics Engine `spinward_play`。
> 検査: `src/app/metrics.test.ts`（クライアント側の記録器）・`worker/index.test.ts`（sink）。

## なぜ

Cloudflare Web Analytics はページビューを数えるが、**ページビューは「投げた」でも「軸に着いた」でもない**。
公開後の30日で30pvと分かっても、その30人が起動3秒で去ったのか軸まで登ったのかは誰にも分からなかった。
配給（Show HN 等）の前にこの漏斗が無いと「来なかった」と「来て3秒で去った」を区別できない。

Analytics Engine は**保持3ヶ月・SQLで読める**（Freeプラン: 書き込み10万点/日）。
方言・落とし穴・読み出しトークンは [ysflight-web `docs/metrics.md`](https://github.com/tomingtoming/ysflight-web/blob/main/docs/metrics.md) が正典で、ここでは繰り返さない。要点だけ:
**件数は `count()` でなく `sum(_sample_interval)`**、**人数（`count(DISTINCT index1)`）は下限として読む**。

## 何を測るか

ツアーの節目（`tourGuide.ts` のイベントid）をそのまま漏斗にする。イベントは5種類。

| イベント | いつ | 主な値 |
|---|---|---|
| `session` | ページロード1回につき1つ | `visits`（この端末の通算・1=初訪問・0=storage不可）・`days`・`ref`（流入元ホスト） |
| `milestone` | 各節目に**初めて**到達した瞬間（1ロード1回） | `m`（`throw` / `jump` / `overlook` / `axis` / `surface` / `spin-change` / `drive` / `rain` / `enter-freefly`）・`secs`（ロードからの可視秒）・`depth`（ここまでの節目数） |
| `vr-start` / `vr-end` | XRセッションの出入り | `secs`（VR秒）・`fps`（平均・計器があるとき） |
| `leave` | `pagehide` | `secs`（可視秒）・`hidden`（非表示だった秒。`secs` からは引き算済み）・`depth`（到達した節目数） |

**両端を記録する**（session と leave）。leave の無い session は「タブを閉じる前に離れた／pagehide が来なかった」で、その差分自体が答えの一部。
**秒は可視秒**＝非表示タブは rAF が止まっているので、壁時計で数えると置きっぱなしが「体験時間」に化ける（ysflight-web 2026-08-30 の 5時間22分）。

### 列（SQLはこの並びを前提に書く）

`index1` はビジターID（localStorage の乱数）＝サンプリングキー。

| 列 | 内容 |
|---|---|
| `blob1` | イベント名 |
| `blob2` | 節目id（`milestone` のみ） |
| `blob3` | preset（`izma` / `playground` / `cooper` / `elysium` / `custom`） |
| `blob4` | entry `landing`（素の玄関）/ `shared`（共有URLから） |
| `blob5` | device `desktop` / `touch` / `vr`（一度VRに入ったら以後 `vr`） |
| `blob6` | 言語 |
| `blob7` | 流入元ホスト（`session` のみ） |
| `blob8` | 終了理由 |
| `blob9` | audience `public` / `dev`（tomingのQA） |
| `blob10` | sid（1ページロードのイベントをまとめるID） |
| `blob11` | ビルドID（git short sha。Workers Builds では commit） |
| `blob12` | **サーバ側**: ホスト名（本番と staging の区別） |
| `blob13` | **サーバ側**: 国コード |
| `blob14` | quality tier `desktop` / `quest` / `phone` |
| `double1` | 秒（可視秒 or VR秒） |
| `double2` | 通算訪問回数 |
| `double3` | 初訪問からの日数 |
| `double4` | 非表示秒（`leave`） |
| `double5` | 到達した節目数 |
| `double6` | 平均fps（あるとき） |

## 端末側の切替（URL・sticky）

| | |
|---|---|
| `?metrics=dev` | 以後この端末の行を `dev` に。QAアクセスを除外するため。**tomingは自分の端末で一度付ける** |
| `?metrics=off` | この端末からは何も送らない |
| `?metrics=public` | 上の2つを解除 |

定点撮影（`~/spinward-bench/shoot.mjs`）は常に `metrics=off` を付ける。

## 読み方（SQL）

```sh
TOK=$(grep '^oauth_token' ~/.wrangler/config/default.toml | sed 's/.*= *"//;s/"//')
ACC=809e6a1cf10d5cd0491c6dff583a88fe
q() { curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACC/analytics_engine/sql" \
        -H "Authorization: Bearer $TOK" -H 'Content-Type: text/plain' --data "$1"; }
```

漏斗（本番・public・直近30日）:

```sql
SELECT blob2 AS milestone,
       sum(_sample_interval) AS rows,
       count(DISTINCT index1) AS visitors_lower_bound
FROM spinward_play
WHERE timestamp > NOW() - INTERVAL '30' DAY
  AND blob12 = 'spinward.toming.app' AND blob9 = 'public' AND blob1 = 'milestone'
GROUP BY blob2 ORDER BY rows DESC
```

来訪と離脱（深さ0で去った人の割合が「起動10秒の勝負」の数字）:

```sql
SELECT double5 AS depth, sum(_sample_interval) AS leaves,
       quantileExactWeighted(0.5)(double1, _sample_interval) AS median_secs
FROM spinward_play
WHERE timestamp > NOW() - INTERVAL '30' DAY
  AND blob12 = 'spinward.toming.app' AND blob9 = 'public' AND blob1 = 'leave'
GROUP BY double5 ORDER BY depth
```

入口別（共有URL vs 玄関）の最初の節目までの秒:

```sql
SELECT blob4 AS entry, blob2 AS milestone,
       quantileExactWeighted(0.5)(double1, _sample_interval) AS median_secs,
       sum(_sample_interval) AS rows
FROM spinward_play
WHERE timestamp > NOW() - INTERVAL '30' DAY AND blob1 = 'milestone' AND blob9 = 'public'
GROUP BY blob4, blob2 ORDER BY entry, rows DESC
```

## 生きているかの確認

配信後に `wrangler tail`（取りこぼしあり・ライブのみ）か Workers Logs で `[metric]` 行を見る。
`{"n":0}` が続くなら sink は届いているがイベントが落ちている（`e` の名前不一致）。
行が一つも出ないなら `run_worker_first` に `/metric` が無いか、クライアントが `?metrics=off` のまま。
