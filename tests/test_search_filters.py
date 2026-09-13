"""Allowlist checks for VectorAI search-filter sanitization."""

from vectorai_filters import sanitize_search_filters


def test_allows_known_comparison_filters():
    cleaned = sanitize_search_filters({
        'score': {'$gte': 5},
        'subreddit': {'$in': ['startups']},
    })
    assert cleaned == {
        'score': {'$gte': 5},
        'subreddit': {'$in': ['startups']},
    }


def test_rejects_operator_injection():
    for payload in (
        {'$where': '1 == 1'},
        {'score': {'$regex': '.*'}},
        {'score': {'$gte': {'$ne': None}}},
        {'unknown_field': {'$eq': 1}},
    ):
        try:
            sanitize_search_filters(payload)
            raise AssertionError(f'expected ValueError for {payload!r}')
        except ValueError:
            pass
