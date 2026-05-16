"""Basic import tests for Reddit-Community-reply-assistant.

Validates that core Python modules can be imported without errors.
"""

def test_import_embedding_server():
    """Test that the embedding server Flask app module imports."""
    import embedding_server
    assert embedding_server is not None


def test_flask_app_exists():
    """Test that the Flask app is defined."""
    from embedding_server import app
    assert app is not None


def test_import_vectorai_bridge():
    """Test that the vectorai bridge module imports."""
    import vectorai_bridge
    assert vectorai_bridge is not None


def test_import_ingest():
    """Test that the ingest module imports."""
    import ingest
    assert ingest is not None
