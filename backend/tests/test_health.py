"""
Unit and integration tests for BreatheWise backend Health endpoint.
"""
from fastapi.testclient import TestClient
from app.main import app
from app.config import Settings

client = TestClient(app)


def test_health_endpoint():
    """Test the /api/health endpoint returns 200 with honest status fields."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "breathewise-backend"
    assert "features" in data
    # Ensure it reflects Phase 3 operational status for Open-Meteo and OpenAQ
    assert data["features"]["open_meteo"] == "operational"
    assert data["features"]["openaq"] == "operational"
    assert data["features"]["ml_predictions"] == "model_not_trained"
    assert data["features"]["database"] == "disabled"


def test_cors_configuration_parsing():
    """Test comma-separated CORS_ORIGINS parsing in Settings."""
    custom_settings = Settings(cors_origins="http://localhost:5173, https://breathewise.vercel.app")
    assert custom_settings.cors_origins == [
        "http://localhost:5173",
        "https://breathewise.vercel.app",
    ]


def test_single_cors_origin():
    """Test single origin string parsing."""
    custom_settings = Settings(cors_origins="http://localhost:3000")
    assert custom_settings.cors_origins == ["http://localhost:3000"]
