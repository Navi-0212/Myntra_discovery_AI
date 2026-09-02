"""
Embeds normalized text and clusters it into behavioral/theme groups.

Same three-stage pattern as Imppulse:
  1. SentenceTransformers -> dense embeddings
  2. UMAP -> dimensionality reduction (clustering algorithms degrade in
     high-dim space; UMAP preserves local structure better than PCA here)
  3. HDBSCAN -> density-based clustering (no need to pre-specify k, and it
     naturally produces a "noise" cluster (-1) for one-off comments that
     don't fit any theme — useful signal on its own, not just discard)
"""

from pathlib import Path
import numpy as np
import pandas as pd

from sentence_transformers import SentenceTransformer
import umap
import hdbscan

EMBED_MODEL = "all-MiniLM-L6-v2"  # fast, good enough for short review/comment text
UMAP_N_NEIGHBORS = 15
UMAP_N_COMPONENTS = 10
UMAP_MIN_DIST = 0.0
HDBSCAN_MIN_CLUSTER_SIZE = 25  # tune based on corpus size; smaller corpus -> lower this
HDBSCAN_MIN_SAMPLES = 5

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"


def embed_texts(texts: list[str], model_name: str = EMBED_MODEL) -> np.ndarray:
    model = SentenceTransformer(model_name)
    return model.encode(texts, show_progress_bar=True, batch_size=64)


def reduce_dimensions(embeddings: np.ndarray) -> np.ndarray:
    n_samples = len(embeddings)
    n_neighbors = min(UMAP_N_NEIGHBORS, max(2, n_samples - 1))
    n_components = min(UMAP_N_COMPONENTS, max(2, n_samples - 2))

    reducer = umap.UMAP(
        n_neighbors=n_neighbors,
        n_components=n_components,
        min_dist=UMAP_MIN_DIST,
        metric="cosine",
        random_state=42,
    )
    return reducer.fit_transform(embeddings)


def cluster_embeddings(reduced: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    n_samples = len(reduced)
    min_cluster_size = min(HDBSCAN_MIN_CLUSTER_SIZE, max(2, n_samples // 4 if n_samples < 50 else HDBSCAN_MIN_CLUSTER_SIZE))
    min_samples = min(HDBSCAN_MIN_SAMPLES, max(1, min_cluster_size // 2))

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method="eom",
    )
    labels = clusterer.fit_predict(reduced)
    probabilities = clusterer.probabilities_
    return labels, probabilities


def run_clustering(df: pd.DataFrame = None) -> pd.DataFrame:
    if df is None:
        df = pd.read_parquet(PROCESSED_DIR / "unified_corpus.parquet")

    print(f"[cluster] embedding {len(df)} documents with {EMBED_MODEL}")
    embeddings = embed_texts(df["text"].tolist())

    print("[cluster] reducing dimensions with UMAP")
    reduced = reduce_dimensions(embeddings)

    print("[cluster] clustering with HDBSCAN")
    labels, probs = cluster_embeddings(reduced)

    df = df.copy()
    df["cluster_id"] = labels
    df["cluster_confidence"] = probs

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = int((labels == -1).sum())
    print(f"[cluster] found {n_clusters} clusters, {n_noise} noise points ({n_noise/len(df):.1%})")

    out_path = PROCESSED_DIR / "clustered_corpus.parquet"
    df.to_parquet(out_path, index=False)
    print(f"[cluster] wrote clustered corpus -> {out_path}")

    return df


if __name__ == "__main__":
    run_clustering()
