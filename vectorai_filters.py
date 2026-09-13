"""Allowlisted VectorAI metadata-filter sanitizer.

Keeps request JSON from becoming query operators ($where, $regex, unknown
fields, nested objects). Imported by vectorai-bridge.py and unit tests.
"""

from __future__ import annotations

import re

_FILTER_FIELD_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_ALLOWED_FILTER_FIELDS = frozenset({
    "subreddit",
    "created_at_reddit",
    "num_comments",
    "score",
    "title",
    "author",
})
_ALLOWED_FILTER_OPS = frozenset({"$in", "$gte", "$lte", "$eq", "$gt", "$lt"})
_SCALAR_TYPES = (str, int, float, bool)


def sanitize_search_filters(filters):
    """Return an allowlisted filter dict or raise ValueError."""
    if filters is None:
        return None
    if not isinstance(filters, dict):
        raise ValueError("filters must be an object")

    cleaned = {}
    for field_name, condition in filters.items():
        if not isinstance(field_name, str) or not _FILTER_FIELD_RE.match(field_name):
            raise ValueError("invalid filter field")
        if field_name not in _ALLOWED_FILTER_FIELDS:
            raise ValueError(f"filter field not allowed: {field_name}")

        if isinstance(condition, dict):
            if not condition or any(op not in _ALLOWED_FILTER_OPS for op in condition):
                raise ValueError("invalid filter operator")
            sanitized_condition = {}
            for op, raw in condition.items():
                if op == "$in":
                    if not isinstance(raw, list) or not all(type(v) in _SCALAR_TYPES for v in raw):
                        raise ValueError("$in values must be scalars")
                    sanitized_condition[op] = list(raw)
                elif op == "$eq":
                    if type(raw) not in _SCALAR_TYPES:
                        raise ValueError("$eq value must be a scalar")
                    sanitized_condition[op] = raw
                else:
                    if type(raw) not in (int, float):
                        raise ValueError("comparison value must be a number")
                    sanitized_condition[op] = raw
            cleaned[field_name] = sanitized_condition
        elif type(condition) in _SCALAR_TYPES:
            cleaned[field_name] = condition
        else:
            raise ValueError("invalid filter condition")
    return cleaned
