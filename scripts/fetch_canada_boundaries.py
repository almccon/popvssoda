#!/usr/bin/env python3
"""Download Statistics Canada's 2021 cartographic boundaries for census divisions
and forward sortation areas (FSAs).

Writes GeoJSON (WGS84) to datadir/reference/statcan/ (gitignored):

  cd.geojson    census divisions (293), the Canadian equivalent of US counties
  fsa.geojson   forward sortation areas (1,643), the first 3 characters of a
                postal code

The files come from Statistics Canada's map service rather than the usual zip
downloads (www12.statcan.gc.ca), which turn away scripted downloads. Same data,
2021 Census cartographic boundary files, Open Government Licence - Canada:
https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer

Vertices are thinned on the server to about 50 m (0.0005 degrees), which is
plenty for assigning FSAs and for drawing.

Run from the repo root:  python3 scripts/fetch_canada_boundaries.py
"""
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "datadir", "reference", "statcan")
SERVICE = ("https://geo.statcan.gc.ca/geo_wa/rest/services/2021/"
           "Cartographic_boundary_files/MapServer")
LAYERS = {"cd.geojson": 4, "fsa.geojson": 14}
BATCH = 50


def get(url):
    with urllib.request.urlopen(url, timeout=300) as r:
        return json.load(r)


def fetch(layer):
    query = urllib.parse.urlencode({"where": "1=1", "returnIdsOnly": "true", "f": "json"})
    ids = sorted(get(f"{SERVICE}/{layer}/query?{query}")["objectIds"])
    features = []
    for i in range(0, len(ids), BATCH):
        query = urllib.parse.urlencode({
            "objectIds": ",".join(map(str, ids[i:i + BATCH])),
            "outFields": "*",
            "outSR": 4326,
            "maxAllowableOffset": 0.0005,
            "geometryPrecision": 5,
            "f": "geojson",
        })
        features += get(f"{SERVICE}/{layer}/query?{query}")["features"]
        print(f"  layer {layer}: {len(features)} / {len(ids)}", file=sys.stderr)
    return {"type": "FeatureCollection", "features": features}


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, layer in LAYERS.items():
        path = os.path.join(OUT, name)
        with open(path, "w") as f:
            json.dump(fetch(layer), f)
        print("wrote", path)


if __name__ == "__main__":
    main()
