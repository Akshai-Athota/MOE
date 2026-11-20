"""Role-based retrieval filters (SPEC §4).

The LLM never sees a chunk the user may not see: these filters are applied inside the
Qdrant query, before anything reaches the prompt.
"""

from qdrant_client import models

from hilde.schemas import ACCESS_BY_ROLE, EMPLOYEE_CATEGORIES, User

# langchain-qdrant stores document metadata under this payload key
M = "metadata."


def _match(key: str, values: list[str]) -> models.FieldCondition:
    return models.FieldCondition(key=M + key, match=models.MatchAny(any=values))


def build_filter(user: User, include_history: bool = False) -> models.Filter:
    """Qdrant filter for what `user` may retrieve.

    include_history=False hides superseded knowledge (it stays stored, for "changed on ..." answers).
    """
    must: list[models.Condition] = [_match("access", ACCESS_BY_ROLE[user.role])]

    if user.role == "employee":
        # everyday topics, OR their own department (incl. items addressed to ALL), OR staff directory
        must.append(
            models.Filter(
                should=[
                    _match("category", EMPLOYEE_CATEGORIES),
                    _match("department", [user.department, "ALL"]),
                    _match("source_type", ["person"]),
                ]
            )
        )

    must_not: list[models.Condition] = []
    if not include_history:
        must_not.append(_match("status", ["superseded"]))

    return models.Filter(must=must, must_not=must_not)
