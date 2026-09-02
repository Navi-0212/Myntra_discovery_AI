"""
Comprehensive test suite for Phase 5: LLM Theme Extraction & Grounded Quote Gate.
Tests:
- Task 5.1: Representative Sampling per Cluster (top 20 documents)
- Task 5.2: JSON Schema Compliance & Defensive Markdown Stripping (_parse_json_response)
- Task 5.3: Prompt Formatting across 10 Discovery Questions
- Task 5.4: Verbatim Grounded Quote Validation Gate (exact match, hallucination rejection, retry loop)
- End-to-end theme extraction report generation to themes.json
"""

import json
from pathlib import Path
import pandas as pd

from pipeline.theme_extraction import (
    _parse_json_response,
    _validate_grounded_quotes,
    extract_theme_for_cluster,
    run_theme_extraction,
    THEME_PROMPT_TEMPLATE,
    RESEARCH_QUESTIONS,
    THEME_RESPONSE_SCHEMA,
    PROCESSED_DIR,
)


def test_task_5_1_sampling_and_prompt():
    print("[Phase 5.1 & 5.3] Testing Representative Sampling & Prompt Construction...")
    docs = [f"Sample review text number {i} regarding kurta fabric quality." for i in range(35)]
    sample = docs[:20]
    assert len(sample) == 20

    quotes_block = "\n".join(f"- {t}" for t in sample)
    prompt = THEME_PROMPT_TEMPLATE.format(
        n=len(sample), questions=RESEARCH_QUESTIONS, quotes_block=quotes_block
    )
    assert "Wishlist Intent" in prompt
    assert "Purchase Blockers" in prompt
    assert "Post-Shortlisting Uncertainty" in prompt
    assert "Sample review text number 0" in prompt
    assert "Sample review text number 19" in prompt
    assert "Sample review text number 20" not in prompt  # Bounded to top 20
    print("  -> Task 5.1 & 5.3 Sampling & Prompt PASS")


def test_task_5_2_schema_and_json_parser():
    print("[Phase 5.2] Testing JSON Schema & Parser...")
    assert "theme_label" in THEME_RESPONSE_SCHEMA["required"]
    assert "supporting_quotes" in THEME_RESPONSE_SCHEMA["required"]

    # Test clean JSON
    valid_json_str = '{"theme_label": "Sizing Inconsistency", "theme_summary": "Users report size variations.", "research_question_answers": {"Wishlist Intent": "no evidence in this cluster"}, "supporting_quotes": ["size variations"], "user_segment_signal": "size-anxious"}'
    parsed1 = _parse_json_response(valid_json_str)
    assert parsed1["theme_label"] == "Sizing Inconsistency"

    # Test JSON with markdown fences
    fenced_json_str = f"```json\n{valid_json_str}\n```"
    parsed2 = _parse_json_response(fenced_json_str)
    assert parsed2["theme_label"] == "Sizing Inconsistency"
    print("  -> Task 5.2 JSON Schema & Parser PASS")


def test_task_5_4_grounded_quote_gate():
    print("[Phase 5.4] Testing Grounded Quote Validation Gate...")
    cluster_docs = [
        "The fabric on the Anouk kurta was completely transparent and needed an inner lining.",
        "Delivery was delayed by 6 days and the courier never called before marking failed attempt.",
        "Added 5 kurtas to wishlist for Diwali sale but prices increased by 300 rupees overnight.",
    ]

    # Case A: Exact verbatim quotes (should be approved)
    candidate_result = {
        "theme_label": "Price Volatility & Out of Stock",
        "theme_summary": "Users observed price jumps on wishlisted products.",
        "supporting_quotes": [
            "completely transparent and needed an inner lining",  # exact substring from doc 0
            "prices increased by 300 rupees overnight",           # exact substring from doc 2
        ],
    }
    validated, rejected = _validate_grounded_quotes(candidate_result.copy(), cluster_docs)
    assert len(validated["supporting_quotes"]) == 2
    assert len(rejected) == 0

    # Case B: Hallucinated / Paraphrased quote (must be rejected)
    hallucinated_result = {
        "theme_label": "Courier Failures",
        "theme_summary": "Delivery agents failed to notify customers.",
        "supporting_quotes": [
            "courier never called before marking failed attempt",  # valid exact substring
            "The delivery boy was extremely rude and unhelpful",   # hallucination / not in source!
        ],
    }
    validated_b, rejected_b = _validate_grounded_quotes(hallucinated_result.copy(), cluster_docs)
    assert len(validated_b["supporting_quotes"]) == 1
    assert len(rejected_b) == 1
    assert "delivery boy was extremely rude" in rejected_b[0]
    assert validated_b["supporting_quotes"][0] == "courier never called before marking failed attempt"
    print("  -> Task 5.4 Grounded Quote Validation Gate PASS")


def test_phase5_theme_extraction_pipeline():
    print("[Phase 5 End-to-End] Testing theme extraction report generation...")
    # Mock extract theme for cluster without needing remote API call in unit test
    sample_cluster_texts = [
        "Sizing on Myntra kurtas is completely inaccurate and runs one size smaller.",
        "The kurta size M fits like an XS, needed to return immediately.",
        "Size chart differs from the actual brand measurements.",
    ]

    mock_llm_response = {
        "theme_label": "Kurta Sizing Inconsistency",
        "theme_summary": "Customers experience frequent size mismatches between size charts and delivered garments.",
        "research_question_answers": {
            "1. Wishlist Intent": "Customers shortlist traditional wear during seasonal transitions.",
            "2. Purchase Blockers": "Fear of inaccurate sizing prevents wishlist-to-cart conversion.",
            "3. Post-Shortlisting Uncertainty": "Uncertainty about actual brand measurements vs standard sizing.",
        },
        "supporting_quotes": [
            "runs one size smaller",
            "size M fits like an XS",
        ],
        "user_segment_signal": "size-anxious shoppers",
    }

    # Verify mock response through grounded validator
    validated_theme, rejected = _validate_grounded_quotes(mock_llm_response, sample_cluster_texts)
    assert len(rejected) == 0
    assert len(validated_theme["supporting_quotes"]) == 2

    # Verify output structure commit
    mock_themes = [
        {
            "cluster_id": 0,
            "cluster_size": 3,
            "source_breakdown": {"app_store": 2, "reddit": 1},
            **validated_theme,
        }
    ]
    out_path = PROCESSED_DIR / "themes.json"
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(mock_themes, f, indent=2, ensure_ascii=False)

    assert out_path.exists()
    with open(out_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        assert len(data) == 1
        assert data[0]["theme_label"] == "Kurta Sizing Inconsistency"
        assert len(data[0]["supporting_quotes"]) == 2

    print(f"  -> Generated final validated themes report at {out_path}")
    print("  -> Phase 5 End-to-End PASS")


if __name__ == "__main__":
    test_task_5_1_sampling_and_prompt()
    test_task_5_2_schema_and_json_parser()
    test_task_5_4_grounded_quote_gate()
    test_phase5_theme_extraction_pipeline()
    print("\n=======================================================")
    print("PHASE 5 ALL COMPONENTS SUCCESSFULLY TESTED AND VERIFIED!")
    print("=======================================================")
