# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "onnxruntime",
#   "huggingface_hub",
#   "numpy",
#   "sentence-transformers>=5.0",
#   "transformers>=5.12",
#   "torch",
#   "model2vec",
# ]
# ///
"""Local embedding server: the production model without Cloudflare, plus eval-only models.

    uv run scripts/local_embed_server.py [--port 8765] [--device mps]

POST /embed {"model": "<id>", "texts": [...]} (or Workers AI's "text") answers {"data": [[...], ...]}.
Callers apply the query/document templates (packages/data/src/models.ts), as with Workers AI.

- "@cf/google/embeddinggemma-300m": the same vectors as Workers AI (fp32 ONNX; cosine 1.0000 on
  80 eval queries). Used by `dev:offline` (LOCAL_EMBED_URL) and EMOJISENSE_LOCAL_EMBED=1 runs.
- "local/<name>": off-the-shelf models Workers AI does not host, for `eval:models` only.
"""

import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import numpy as np

HF_IDS = {
    "local/granite-97m-r2": "ibm-granite/granite-embedding-97m-multilingual-r2",
    "local/bekko-a8m": "hotchpotch/bekko-embedding-v1-a8m",
    "local/bekko-a25m": "hotchpotch/bekko-embedding-v1-a25m",
    "local/e5-small": "intfloat/multilingual-e5-small",
    "local/potion-multi": "minishlab/potion-multilingual-128M",
}
STATIC_MODELS = {"local/potion-multi"}
EMBEDDINGGEMMA = "@cf/google/embeddinggemma-300m"
KNOWN = sorted([EMBEDDINGGEMMA, *HF_IDS])


class OnnxEmbeddingGemma:
    """EmbeddingGemma as Workers AI serves it: the onnx-community fp32 export, `sentence_embedding`.

    int8 drifts (cosine ≥ 0.990) and is slower on CPU, so fp32 it is.
    """

    REPO = "onnx-community/embeddinggemma-300m-ONNX"

    def __init__(self):
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from transformers import AutoTokenizer

        # A plain directory, not the hub cache: ONNX Runtime refuses external data behind its symlinks.
        directory = Path.home() / ".cache" / "emojisense" / "embeddinggemma-onnx"
        path = hf_hub_download(self.REPO, "onnx/model.onnx", local_dir=directory)
        hf_hub_download(self.REPO, "onnx/model.onnx_data", local_dir=directory)
        self.tokenizer = AutoTokenizer.from_pretrained(self.REPO)
        self.session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.inputs = [i.name for i in self.session.get_inputs()]

    def encode(self, texts, batch_size=32):
        vectors = []
        for start in range(0, len(texts), batch_size):
            encoded = self.tokenizer(texts[start : start + batch_size], padding=True, return_tensors="np")
            feed = {name: encoded[name].astype(np.int64) for name in self.inputs}
            vectors.append(self.session.run(["sentence_embedding"], feed)[0])
        return np.concatenate(vectors)


loaded = {}


def load(model_id, device):
    if model_id not in loaded:
        if model_id == EMBEDDINGGEMMA:
            loaded[model_id] = OnnxEmbeddingGemma()
        elif model_id in STATIC_MODELS:
            from model2vec import StaticModel

            loaded[model_id] = StaticModel.from_pretrained(HF_IDS[model_id])
        else:
            from sentence_transformers import SentenceTransformer

            loaded[model_id] = SentenceTransformer(HF_IDS[model_id], device=device)
    return loaded[model_id]


def make_handler(device):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/embed":
                self.send_error(404)
                return
            body = json.loads(self.rfile.read(int(self.headers["content-length"])))
            model_id = body.get("model")
            texts = body.get("texts", body.get("text"))
            if isinstance(texts, str):
                texts = [texts]
            if model_id not in KNOWN or not isinstance(texts, list):
                self.send_error(400, f"unknown model {model_id!r} or missing texts (known: {KNOWN})")
                return
            vectors = load(model_id, device).encode(texts, batch_size=32)
            payload = json.dumps({"data": vectors.tolist()}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format, *args):
            pass

    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--device", default="mps")
    options = parser.parse_args()
    # One request at a time: MPS is not safe for concurrent encodes.
    server = HTTPServer(("127.0.0.1", options.port), make_handler(options.device))
    print(f"local embed server on http://127.0.0.1:{options.port} ({options.device})", flush=True)
    server.serve_forever()
