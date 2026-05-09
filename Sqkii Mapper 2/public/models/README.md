# Deblur model

This folder contains the real NAFNet ONNX deblurring model used by Jigsaw Finder Focus:

```text
nafnet_deblur.onnx
```

Source model:

```text
https://huggingface.co/opencv/deblurring_nafnet
deblurring_nafnet_2025may.onnx
```

At runtime the Jigsaw Finder Focus button loads:

```text
/sqkiimapper2/models/nafnet_deblur.onnx
```

The app sends RGB float32 input in NCHW shape `[1, 3, H, W]`, normalized to `0-1`. Images are resized into a max 512 px frame and edge-padded before inference.
