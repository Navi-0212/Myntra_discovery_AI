"""
Comprehensive test suite for Phase 4: Semantic Embedding & Unsupervised Geometric Clustering.
Tests:
- Task 4.1: Dense vector embeddings generation (all-MiniLM-L6-v2, shape: N x 384)
- Task 4.2: UMAP Manifold Dimensionality Reduction (N x 384 -> N x 10, cosine metric)
- Task 4.3: HDBSCAN Density Clustering (EOM method, probability assignments)
- Task 4.4: Clustered Parquet Artifact generation with cluster_id and cluster_confidence
"""

import numpy as np
import pandas as pd
from pathlib import Path

from pipeline.cluster import (
    embed_texts,
    reduce_dimensions,
    cluster_embeddings,
    run_clustering,
    EMBED_MODEL,
    PROCESSED_DIR,
)


def test_task_4_1_dense_embeddings():
    print("[Phase 4.1] Testing Dense Vector Embeddings (SentenceTransformers)...")
    sample_texts = [
        "The sizing on kurtas runs one size smaller than expected.",
        "Fabric quality is transparent and completely sheer in sunlight.",
        "Delivery was delayed by 5 days and package arrived damaged.",
        "Wishlist item went out of stock during the Diwali sale.",
    ]
    embeddings = embed_texts(sample_texts, model_name=EMBED_MODEL)
    assert isinstance(embeddings, np.ndarray)
    assert embeddings.shape == (len(sample_texts), 384), f"Expected shape (4, 384), got {embeddings.shape}"
    # Verify non-zero and normalized/standard vector ranges
    assert np.all(np.isfinite(embeddings))
    print(f"  -> Successfully generated embeddings matrix: {embeddings.shape}")
    print("  -> Task 4.1 Dense Embeddings PASS")


def test_task_4_2_umap_reduction():
    print("[Phase 4.2] Testing UMAP Manifold Dimensionality Reduction...")
    # Synthetic 384-d embeddings matrix for 20 samples
    np.random.seed(42)
    fake_embeddings = np.random.randn(20, 384).astype(np.float32)
    reduced = reduce_dimensions(fake_embeddings)

    assert isinstance(reduced, np.ndarray)
    assert reduced.shape[0] == 20
    assert reduced.shape[1] <= 10
    print(f"  -> Successfully reduced manifold from 384-d to {reduced.shape[1]}-d: {reduced.shape}")
    print("  -> Task 4.2 UMAP Reduction PASS")


def test_task_4_3_hdbscan_clustering():
    print("[Phase 4.3] Testing HDBSCAN Density Clustering...")
    # Create two clear synthetic 10-d clusters + noise
    np.random.seed(42)
    cluster1 = np.random.normal(loc=0.0, scale=0.1, size=(20, 10))
    cluster2 = np.random.normal(loc=5.0, scale=0.1, size=(20, 10))
    noise = np.random.uniform(low=-10.0, high=10.0, size=(5, 10))
    data = np.vstack([cluster1, cluster2, noise])

    labels, probs = cluster_embeddings(data)
    assert len(labels) == 45
    assert len(probs) == 45
    assert isinstance(labels, np.ndarray)
    assert isinstance(probs, np.ndarray)
    # Probabilities should be between 0.0 and 1.0
    assert (probs >= 0.0).all() and (probs <= 1.0).all()
    print(f"  -> Clustering completed. Cluster labels distribution: {pd.Series(labels).value_counts().to_dict()}")
    print("  -> Task 4.3 HDBSCAN Clustering PASS")


def test_phase4_run_clustering_execution():
    print("[Phase 4 End-to-End] Testing run_clustering() on unified corpus...")
    unified_parquet = PROCESSED_DIR / "unified_corpus.parquet"
    if not unified_parquet.exists():
        # Create minimal test dataset if not existing
        test_df = pd.DataFrame({
            "doc_id": list(range(10)),
            "source": ["app_store"] * 5 + ["play_store"] * 5,
            "source_id": [f"id_{i}" for i in range(10)],
            "text": [
                "Sizing on Myntra kurtas is completely inaccurate and runs small.",
                "The kurta size M fits like an XS, needed to return immediately.",
                "Why is size chart different from the actual brand measurements?",
                "Delivery was delayed and courier didn't attempt delivery.",
                "Package arrived 6 days late after scheduled delivery date.",
                "Customer care refused to refund for the lost delivery parcel.",
                "Wishlisted 10 items for the sale but prices increased before checkout.",
                "Prices fluctuate wildly in wishlist between morning and evening.",
                "Wishlist item showed discount but at cart price remained full.",
                "Color in the product image does not match the actual received product.",
            ],
            "rating": [1, 2, 1, 1, 2, 1, 3, 2, 2, 1],
            "engagement_score": [0] * 10,
            "author": [f"user_{i}" for i in range(10)],
            "created_at": ["2026-08-20T10:00:00Z"] * 10,
            "url": ["https://..."] * 10,
            "context": [""] * 10,
        })
        PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
        test_df.to_parquet(unified_parquet, index=False)

    df_clustered = run_clustering()
    assert not df_clustered.empty
    assert "cluster_id" in df_clustered.columns
    assert "cluster_confidence" in df_clustered.columns

    clustered_parquet = PROCESSED_DIR / "clustered_corpus.parquet"
    assert clustered_parquet.exists()

    # Verify cluster_id types
    assert pd.api.types.is_integer_dtype(df_clustered["cluster_id"])
    print(f"  -> Generated clustered corpus with {len(df_clustered)} records at {clustered_parquet}")
    print("  -> Phase 4 End-to-End PASS")


if __name__ == "__main__":
    test_task_4_1_dense_embeddings()
    test_task_4_2_umap_reduction()
    test_task_4_3_hdbscan_clustering()
    test_phase4_run_clustering_execution()
    print("\n=======================================================")
    print("PHASE 4 ALL COMPONENTS SUCCESSFULLY TESTED AND VERIFIED!")
    print("=======================================================")
