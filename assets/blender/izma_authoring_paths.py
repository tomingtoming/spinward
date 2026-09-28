"""Explicit data root and neighbourhood input for a complete city export."""
import os
from pathlib import Path


def authoring_root():
    root = Path(os.environ.get('SPINWARD_AUTHORING_ROOT', Path(__file__).resolve().parents[2]))
    assert root.is_absolute(), 'Authoring root must be an absolute path'
    return root


def neighbourhood_contract_name():
    return 'izma-city-neighbourhoods.json' if os.environ.get('SPINWARD_CITY_FABRIC') == '1' else 'izma-neighbourhood-parcels.json'


def city_asset_name(name):
    if os.environ.get('SPINWARD_CITY_FABRIC') == '1':
        assert name.startswith(('izma-land-use', 'izma-street-frontages')), name
        return name.replace('izma-', 'izma-city-', 1)
    return name
