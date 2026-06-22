# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""ONNX inference for the ContactSheet semantic-search sidecar.

Loads a multilingual SigLIP 2 (base) encoder as two ONNX graphs — a vision tower and a text
tower — and runs them on the CPU via ONNX Runtime. No PyTorch: the only heavy dependency is
`onnxruntime`, which keeps the image small enough to justify a separate optional container. The
HuggingFace processor/tokenizer handle pre-processing (image resize/normalise, text tokenise);
ONNX Runtime does the forward pass; we L2-normalise the result so the backend can rank by dot
product.

Model resolution: `MODEL_ID` is a HuggingFace repo in the Transformers.js ONNX layout (default
`onnx-community/siglip2-base-patch16-256-ONNX`), which ships `onnx/vision_model.onnx` and
`onnx/text_model.onnx` (plus `*_quantized.onnx`). `ONNX_QUANTIZED=1` selects the INT8 graphs for
~4× less memory and faster CPU inference at a small accuracy cost.

NOTE: ONNX graph input/output names differ between exports. Verified against
`onnx-community/siglip2-base-patch16-256-ONNX` (2026-06): both towers expose the 768-dim embedding
as `pooler_output`; the vision tower takes `pixel_values`, the text tower takes `input_ids` only.
This module is the single place that knows the graph shape — if a future model differs, adjust the
`_*_OUTPUT` constants and input keys here. That repo also ships *only* the quantized graphs and a
fast `tokenizer.json` (no SentencePiece `spiece.model`), so we force the fast tokenizer.
"""

from __future__ import annotations

import logging
import os
import threading

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from PIL import Image
from transformers import AutoImageProcessor, AutoTokenizer

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


def _l2(vec: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 0 else vec


class Encoder:
    """Lazily-loaded vision + text ONNX sessions. Thread-safe for the small sidecar pool."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ready = False
        self._vision: ort.InferenceSession | None = None
        self._text: ort.InferenceSession | None = None
        self._processor = None
        self._tokenizer = None

    # -- loading -------------------------------------------------------------------------------
    def _session(self, filename: str) -> ort.InferenceSession:
        path = hf_hub_download(repo_id=MODEL_ID, filename=filename)
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = _INTRA_THREADS
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        return ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])

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
            # Image processor only (decoupled from the tokenizer); fast tokenizer for text since
            # the ONNX repos ship tokenizer.json but no SentencePiece vocab.
            self._processor = AutoImageProcessor.from_pretrained(MODEL_ID)
            self._tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, use_fast=True)
            self._ready = True
            logger.info("Encoder ready.")

    @property
    def ready(self) -> bool:
        return self._ready

    # -- inference -----------------------------------------------------------------------------
    def embed_image(self, image_path: str) -> list[float]:
        self.load()
        with Image.open(image_path) as img:
            img = img.convert("RGB")
            inputs = self._processor(images=img, return_tensors="np")
        feeds = {"pixel_values": inputs["pixel_values"].astype(np.float32)}
        out = self._vision.run([_VISION_OUTPUT], feeds)[0]
        return _l2(np.asarray(out[0], dtype=np.float32)).tolist()

    def embed_text(self, text: str) -> list[float]:
        self.load()
        enc = self._tokenizer(
            text,
            return_tensors="np",
            padding="max_length",
            max_length=TEXT_MAX_LEN,
            truncation=True,
        )
        feeds = {"input_ids": enc["input_ids"].astype(np.int64)}
        if "attention_mask" in enc:
            feeds["attention_mask"] = enc["attention_mask"].astype(np.int64)
        # Some SigLIP text exports take only input_ids; drop unknown feeds defensively.
        feeds = {k: v for k, v in feeds.items() if k in {i.name for i in self._text.get_inputs()}}
        out = self._text.run([_TEXT_OUTPUT], feeds)[0]
        return _l2(np.asarray(out[0], dtype=np.float32)).tolist()


encoder = Encoder()
