# Sqkii Mapper 2

GitHub Pages site: https://weakcat3000.github.io/sqkiimapper2/

## Jigsaw Finder Focus

The Jigsaw Finder includes a fully client-side Focus button for image deblurring. It runs in the browser only: no backend, no Python server, and no inference API calls.

How it works:

- The user captures or selects a clue photo in Jigsaw Finder.
- The original photo is previewed in the capture area.
- The Adjust Image panel uses canvas for blur, brightness, night, and dark adjustments.
- The Focus button loads an ONNX deblurring model with `onnxruntime-web`.
- Images are resized into a safe max 512 px inference frame and edge-padded when needed so the NAFNet encoder has enough spatial area.
- Pixels are converted to a Float32 RGB tensor in NCHW format: `[1, 3, H, W]`, normalized to `0-1`.
- The model output tensor is converted back to a canvas image.
- The Download button saves the current adjusted/focused canvas as a PNG.

## ONNX Model

The real NAFNet ONNX deblurring model is included here:

```text
Sqkii Mapper 2/public/models/nafnet_deblur.onnx
```

Model source:

```text
https://huggingface.co/opencv/deblurring_nafnet
```

Bundled file:

```text
deblurring_nafnet_2025may.onnx
```

After Vite builds the site, that file is served on GitHub Pages at:

```text
/sqkiimapper2/models/nafnet_deblur.onnx
```

If the model file is missing or cannot be loaded, the UI shows a friendly message instead of failing silently.

The expected model contract is:

- Input: RGB float32 tensor `[1, 3, H, W]`
- Values: normalized `0-1`
- Output: RGB image tensor, preferably `[1, 3, H, W]`

If your exported NAFNet model uses different input or output names, the app uses the first model input and first model output automatically.

## Browser Support

The Focus feature uses ONNX Runtime Web. It tries WebGPU first when the browser exposes `navigator.gpu`, then falls back to WASM.

- WebGPU is best on recent Chrome or Edge.
- Safari and iPhone browsers generally use the WASM fallback.
- ONNX Runtime Web WASM files are loaded from the pinned jsDelivr package path for `onnxruntime-web@1.26.0`, so GitHub Pages does not need a Node server after deployment.

## Deployment Notes

The app is built with Vite and uses the GitHub Pages base path `/sqkiimapper2/`.

```bash
cd "Sqkii Mapper 2"
npm install
npm run build
```

Deploy the generated `dist/` folder to GitHub Pages. The included model is copied from `public/models/nafnet_deblur.onnx` into the static build.
