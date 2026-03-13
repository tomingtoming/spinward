# Quest WebXR Demo

Meta Quest 3S のブラウザで開けるように、`vite + typescript + three.js` で最小の WebXR デモを構成しています。

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
