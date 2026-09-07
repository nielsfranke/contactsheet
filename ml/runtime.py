# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""ONNX inference for the ContactSheet semantic-search sidecar.

Loads a multilingual SigLIP 2 (base) encoder as two ONNX graphs — a vision tower and a text
tower — and runs them on the CPU via ONNX Runtime. No PyTorch: the only heavy dependency is
`onnxruntime`, which keeps the image small enough to justify a separate optional container.
Pre-processing is done here (image resize/normalise with Pillow + NumPy, text tokenised by the
`tokenizers` Rust library); ONNX Runtime does the forward pass; we L2-normalise the result so the
backend can rank by dot product.

No `transformers` dependency: its 5.x image processors hard-require PyTorch/Torchvision, and its
4.x line ended at 4.57.6 (so its advisories are unfixable by pin). Both pieces we used are small
and fully specified by files the model repo ships — `preprocessor_config.json` and
`tokenizer.json` — so we read those directly. Verified bit-identical to
`SiglipImageProcessor`/`AutoTokenizer` against the pinned repo (pixel maxdiff 0.0, same token ids),
which matters: existing vectors in the backend's database must stay comparable to new ones.

Model resolution: `MODEL_ID` is a HuggingFace repo in the Transformers.js ONNX layout (default
`onnx-community/siglip2-base-patch16-256-ONNX`), which ships `onnx/vision_model.onnx` and
`onnx/text_model.onnx` (plus `*_quantized.onnx`). `ONNX_QUANTIZED=1` selects the INT8 graphs for
~4× less memory and faster CPU inference at a small accuracy cost.

NOTE: ONNX graph input/output names differ between exports. Verified against
`onnx-community/siglip2-base-patch16-256-ONNX` (2026-06): both towers expose the 768-dim embedding
as `pooler_output`; the vision tower takes `pixel_values`, the text tower takes `input_ids` only.
This module is the single place that knows the graph shape — if a future model differs, adjust the
`_*_OUTPUT` constants and input keys here. That repo also ships *only* the quantized graphs and a
`tokenizer.json` (no SentencePiece `spiece.model`), which is exactly what the Rust tokenizer reads.
"""

from __future__ import annotations

import json
import logging
import os
import threading

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from PIL import Image
from tokenizers import Tokenizer

logger = logging.getLogger("contactsheet-ml")

MODEL_ID = os.environ.get("MODEL_ID", "onnx-community/siglip2-base-patch16-256-ONNX")
# Logical name the backend stores alongside each vector; must match app_settings.semantic_search.model.
MODEL_NAME = os.environ.get("MODEL_NAME", "siglip2-base-multilingual")
QUANTIZED = os.environ.get("ONNX_QUANTIZED", "1") not in ("0", "false", "False", "")
# SigLIP text towers are trained at a fixed 64-token length, padded to max_length.
TEXT_MAX_LEN = int(os.environ.get("TEXT_MAX_LEN", "64"))
_INTRA_THREADS = int(os.environ.get("ORT_INTRA_THREADS", "4"))

_VISION_OUTPUT = "pooler_output"
_TEXT_OUTPUT = "pooler_output"

# SigLIP defaults, used when the repo ships no preprocessor_config.json.
_DEFAULT_SIZE = 256
_DEFAULT_MEAN = (0.5, 0.5, 0.5)
_DEFAULT_STD = (0.5, 0.5, 0.5)
# `resample` in preprocessor_config.json is a PIL filter number (2 = BILINEAR, SigLIP's default).
_RESAMPLE = {
    0: Image.NEAREST,
    1: Image.LANCZOS,
    2: Image.BILINEAR,
    3: Image.BICUBIC,
    4: Image.BOX,
    5: Image.HAMMING,
}


def _l2(vec: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 0 else vec


class ImagePreprocessor:
    """The `SiglipImageProcessor` pipeline in NumPy: resize → rescale → normalise → CHW."""

    def __init__(self, config: dict) -> None:
        size = config.get("size") or {}
        if "height" in size and "width" in size:
            self.width, self.height = int(size["width"]), int(size["height"])
        else:
            edge = int(size.get("shortest_edge", _DEFAULT_SIZE))
            self.width = self.height = edge
        self.resample = _RESAMPLE.get(config.get("resample", 2), Image.BILINEAR)
        self.rescale = float(config.get("rescale_factor", 1 / 255)) if config.get("do_rescale", True) else 1.0
        if config.get("do_normalize", True):
            self.mean = np.asarray(config.get("image_mean") or _DEFAULT_MEAN, dtype=np.float32)
            self.std = np.asarray(config.get("image_std") or _DEFAULT_STD, dtype=np.float32)
        else:
            self.mean = np.zeros(3, dtype=np.float32)
            self.std = np.ones(3, dtype=np.float32)

    def __call__(self, img: Image.Image) -> np.ndarray:
        img = img.convert("RGB").resize((self.width, self.height), self.resample)
        # Arithmetic order matters and is deliberate: rescale the uint8 array by a Python float
        # (NumPy promotes to float64) and round to float32 *once*, then normalise in float32 —
        # exactly what transformers' rescale()/normalize() did. Multiplying in float32 instead
        # shifts pixels by one ULP, and the INT8 graph amplifies that into a visible embedding
        # drift (cosine ~0.99 against the same photo's stored vector). Verified bit-identical.
        arr = (np.asarray(img) * self.rescale).astype(np.float32)
        arr = ((arr - self.mean) / self.std).astype(np.float32)
        # HWC → NCHW, the layout every SigLIP vision export expects.
        return arr.transpose(2, 0, 1)[None]


class Encoder:
    """Lazily-loaded vision + text ONNX sessions. Thread-safe for the small sidecar pool."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ready = False
        self._vision: ort.InferenceSession | None = None
        self._text: ort.InferenceSession | None = None
        self._processor: ImagePreprocessor | None = None
        self._tokenizer: Tokenizer | None = None

    # -- loading -------------------------------------------------------------------------------
    def _session(self, filename: str) -> ort.InferenceSession:
        path = hf_hub_download(repo_id=MODEL_ID, filename=filename)
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = _INTRA_THREADS
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        return ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])

    def _load_processor(self) -> ImagePreprocessor:
        try:
            path = hf_hub_download(repo_id=MODEL_ID, filename="preprocessor_config.json")
            with open(path, encoding="utf-8") as fh:
                config = json.load(fh)
        except Exception:  # noqa: BLE001 — a repo without the file is fine; SigLIP defaults apply.
            logger.warning("No preprocessor_config.json for %s — using SigLIP defaults.", MODEL_ID)
            config = {}
        return ImagePreprocessor(config)

    def _load_tokenizer(self) -> Tokenizer:
        tokenizer = Tokenizer.from_file(hf_hub_download(repo_id=MODEL_ID, filename="tokenizer.json"))
        # The repo's tokenizer.json already pads to the trained length, but pin both ends anyway so
        # a repo that omits them still feeds the text tower a fixed-width batch.
        padding = tokenizer.padding or {}
        tokenizer.enable_padding(
            length=TEXT_MAX_LEN,
            pad_id=int(padding.get("pad_id", 0)),
            pad_token=str(padding.get("pad_token", "<pad>")),
            direction=str(padding.get("direction", "right")),
        )
        tokenizer.enable_truncation(max_length=TEXT_MAX_LEN)
        return tokenizer

    def load(self) -> None:
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            suffix = "_quantized" if QUANTIZED else ""
            logger.info("Loading %s (quantized=%s)…", MODEL_ID, QUANTIZED)
            self._vision = self._session(f"onnx/vision_model{suffix}.onnx")
            self._text = self._session(f"onnx/text_model{suffix}.onnx")
            self._processor = self._load_processor()
            self._tokenizer = self._load_tokenizer()
            self._ready = True
            logger.info("Encoder ready.")

    @property
    def ready(self) -> bool:
        return self._ready

    # -- inference -----------------------------------------------------------------------------
    def embed_image(self, image_path: str) -> list[float]:
        self.load()
        with Image.open(image_path) as img:
            pixel_values = self._processor(img)
        feeds = {"pixel_values": pixel_values.astype(np.float32)}
        out = self._vision.run([_VISION_OUTPUT], feeds)[0]
        return _l2(np.asarray(out[0], dtype=np.float32)).tolist()

    def embed_text(self, text: str) -> list[float]:
        self.load()
        enc = self._tokenizer.encode(text)
        feeds = {
            "input_ids": np.asarray([enc.ids], dtype=np.int64),
            "attention_mask": np.asarray([enc.attention_mask], dtype=np.int64),
        }
        # Some SigLIP text exports take only input_ids; drop unknown feeds defensively.
        feeds = {k: v for k, v in feeds.items() if k in {i.name for i in self._text.get_inputs()}}
        out = self._text.run([_TEXT_OUTPUT], feeds)[0]
        return _l2(np.asarray(out[0], dtype=np.float32)).tolist()


encoder = Encoder()
