"""Endpoint tests for /api/predict and /api/predict/batch."""
from unittest.mock import patch


# --- /api/predict ---

def test_predict_missing_lat_lon(client):
    resp = client.post('/api/predict', json={})
    assert resp.status_code == 400
    assert 'error' in resp.get_json()


def test_predict_missing_lon(client):
    resp = client.post('/api/predict', json={'lat': 34.05})
    assert resp.status_code == 400


def test_predict_missing_lat(client):
    resp = client.post('/api/predict', json={'lon': -118.25})
    assert resp.status_code == 400


def test_predict_invalid_lat_lon_type(client):
    resp = client.post('/api/predict', json={'lat': 'abc', 'lon': 'xyz'})
    assert resp.status_code == 400


def test_predict_valid_returns_expected_shape(client):
    with patch('routes.predict.get_weather', return_value={'wind_speed': 5.0, 'temperature_celsius': 30.0}), \
         patch('routes.predict.get_elevation', return_value=200.0), \
         patch('routes.predict.get_evi', return_value=0.3):

        resp = client.post('/api/predict', json={'lat': 34.05, 'lon': -118.25})

    assert resp.status_code == 200
    data = resp.get_json()
    assert 'prediction' in data
    assert 'risk_level' in data['prediction']
    assert 'risk_probability' in data['prediction']
    assert 'features' in data
    assert 'location' in data
    assert 'model' in data


def test_predict_risk_level_is_valid_label(client):
    with patch('routes.predict.get_weather', return_value={'wind_speed': 5.0, 'temperature_celsius': 30.0}), \
         patch('routes.predict.get_elevation', return_value=200.0), \
         patch('routes.predict.get_evi', return_value=0.3):

        resp = client.post('/api/predict', json={'lat': 34.05, 'lon': -118.25})

    data = resp.get_json()
    assert data['prediction']['risk_level'] in ('Low', 'Medium', 'High', 'Extreme')


def test_predict_risk_probability_in_range(client):
    with patch('routes.predict.get_weather', return_value={'wind_speed': 5.0, 'temperature_celsius': 30.0}), \
         patch('routes.predict.get_elevation', return_value=200.0), \
         patch('routes.predict.get_evi', return_value=0.3):

        resp = client.post('/api/predict', json={'lat': 34.05, 'lon': -118.25})

    data = resp.get_json()
    prob = data['prediction']['risk_probability']
    assert 0.0 <= prob <= 1.0


def test_predict_falls_back_when_live_data_fails(client):
    with patch('routes.predict.get_weather', side_effect=Exception('timeout')), \
         patch('routes.predict.get_elevation', side_effect=Exception('timeout')), \
         patch('routes.predict.get_evi', side_effect=Exception('timeout')):

        resp = client.post('/api/predict', json={'lat': 34.05, 'lon': -118.25})

    assert resp.status_code == 200
    data = resp.get_json()
    assert data['features']['evi_source'] == 'fallback'
    assert data['features']['lst_source'] == 'fallback'
    assert data['features']['elevation_source'] == 'fallback'


def test_predict_live_sources_reported(client):
    with patch('routes.predict.get_weather', return_value={'wind_speed': 3.0, 'temperature_celsius': 25.0}), \
         patch('routes.predict.get_elevation', return_value=100.0), \
         patch('routes.predict.get_evi', return_value=0.2):

        resp = client.post('/api/predict', json={'lat': 34.05, 'lon': -118.25})

    data = resp.get_json()
    assert data['features']['evi_source'] == 'live'
    assert data['features']['lst_source'] == 'live'
    assert data['features']['elevation_source'] == 'live'


def test_predict_location_echoes_request(client):
    with patch('routes.predict.get_weather', return_value={'wind_speed': 5.0, 'temperature_celsius': 30.0}), \
         patch('routes.predict.get_elevation', return_value=200.0), \
         patch('routes.predict.get_evi', return_value=0.3):

        resp = client.post('/api/predict', json={'lat': 34.05, 'lon': -118.25})

    data = resp.get_json()
    assert data['location']['requested_lat'] == 34.05
    assert data['location']['requested_lon'] == -118.25


# --- /api/predict/batch ---

def test_predict_batch_missing_items(client):
    resp = client.post('/api/predict/batch', json={})
    assert resp.status_code == 400


def test_predict_batch_empty_items(client):
    resp = client.post('/api/predict/batch', json={'items': []})
    assert resp.status_code == 400


def test_predict_batch_item_missing_lat(client):
    resp = client.post('/api/predict/batch', json={'items': [{'lon': -118.25}]})
    assert resp.status_code == 400


def test_predict_batch_item_missing_lon(client):
    resp = client.post('/api/predict/batch', json={'items': [{'lat': 34.05}]})
    assert resp.status_code == 400


def test_predict_batch_item_invalid_types(client):
    resp = client.post('/api/predict/batch', json={'items': [{'lat': 'bad', 'lon': 'bad'}]})
    assert resp.status_code == 400


def test_predict_batch_valid_returns_results_list(client):
    with patch('routes.predict.get_weather', return_value={'wind_speed': 5.0, 'temperature_celsius': 30.0}), \
         patch('routes.predict.get_elevation', return_value=200.0), \
         patch('routes.predict.get_evi', return_value=0.3):

        resp = client.post('/api/predict/batch', json={
            'items': [
                {'lat': 34.05, 'lon': -118.25},
                {'lat': 37.77, 'lon': -122.41},
            ]
        })

    assert resp.status_code == 200
    data = resp.get_json()
    assert 'results' in data
    assert len(data['results']) == 2


def test_predict_batch_each_result_has_prediction(client):
    with patch('routes.predict.get_weather', return_value={'wind_speed': 5.0, 'temperature_celsius': 30.0}), \
         patch('routes.predict.get_elevation', return_value=200.0), \
         patch('routes.predict.get_evi', return_value=0.3):

        resp = client.post('/api/predict/batch', json={
            'items': [{'lat': 34.05, 'lon': -118.25}]
        })

    result = resp.get_json()['results'][0]
    assert 'prediction' in result
    assert 'risk_level' in result['prediction']
    assert 'risk_probability' in result['prediction']
