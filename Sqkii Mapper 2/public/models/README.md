# Deblur model placeholder

Place the real NAFNet ONNX model here:

```text
nafnet_deblur.onnx
```

At runtime the Jigsaw Finder Focus button loads:

```text
/sqkiimapper2/models/nafnet_deblur.onnx
```

The app expects RGB float32 input in NCHW shape `[1, 3, H, W]`, normalized to `0-1`.
