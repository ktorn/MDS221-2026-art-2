# Teia NFT mint bundle — Naive Babel Study

Self-contained offline build for [teia.art/mint](https://teia.art/mint). Exhibition install with ESP32 weight sensor lives on `main` in `digital/` and `tangible/`.

## Local test

```bash
cd nft
python3 -m http.server 8000
```

Open http://localhost:8000 — click the canvas, then **S** / **R** to stack blocks.

## Zip for upload

```bash
cd nft && zip -r ../nft.zip . -x "*.DS_Store"
```

Upload `nft.zip` at teia.art/mint. Confirm preview interaction before minting.

## Controls (NFT)

| Key | Action |
|-----|--------|
| S | Square block layer |
| R | Horizontal rectangle layer |
| P | Save PNG |
| F | Fullscreen |

## Files

- `index.html` — Teia entry (og:image → thumbnail.png)
- `script.js` — offline sketch (no network)
- `p5.min.js` — local p5 1.9.3
- `assets/oil-texture-reference.png` — block texture
- `thumbnail.png` — cover image
- `metadata.txt` — title, description, tags for mint form

Do not commit `nft.zip` or secrets files.
