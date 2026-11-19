#!/usr/bin/env python3
"""Total the Canadian responses by census division, the Canadian equivalent of
a US county.

The survey only has the first 3 characters of Canadian postal codes (the FSA),
and FSAs don't nest inside census divisions. Each FSA goes to the census
division that holds the largest share of its land area, the same rule used for
US ZIP codes and counties. FSAs missing from the 2021 boundaries (retired
codes) fall back to the division containing their point in postal_counts.csv.

Inputs:
  data/postal_counts.csv
  datadir/reference/statcan/cd.geojson, fsa.geojson
      from scripts/fetch_canada_boundaries.py

Writes:
  data/fsa_census_division.csv      FSA -> census division, with land shares
  data/census_division_counts.csv   responses by census division
  datadir/reference/statcan/cd_for_topojson.geojson
      census divisions with only the fields the map needs, ready to
      convert to d3/canada.json with mapshaper (see data/README.md)

Needs shapely and pyproj:  pip install shapely pyproj
Run from the repo root:    python3 scripts/build_canada_divisions.py
"""
import collections
import csv
import json
import os

from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.ops import transform
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
STATCAN = os.path.join(ROOT, "datadir", "reference", "statcan")

# Province codes used in the survey, by Statistics Canada province ID.
PROVINCE = {
    "10": "NL", "11": "PE", "12": "NS", "13": "NB", "24": "QC", "35": "ON",
    "46": "MB", "47": "SK", "48": "AB", "59": "BC", "60": "YT", "61": "NT",
    "62": "NU",
}
# Statistics Canada's census division type codes.
CD_TYPE = {
    "CDR": "Census division", "CT": "County", "CTY": "County",
    "DIS": "District", "DM": "District municipality", "MRC": "Regional county municipality",
    "RD": "Regional district", "REG": "Region", "RM": "Regional municipality",
    "TÉ": "Territory equivalent", "TER": "Territory", "UC": "United counties",
}
TERMS = ["pop", "soda", "coke", "other"]

# Equal-area projection for comparing land areas.
to_albers = Transformer.from_crs(
    "EPSG:4326", "+proj=aea +lat_0=40 +lon_0=-96 +lat_1=50 +lat_2=70 +datum=WGS84",
    always_xy=True).transform


def load(name):
    with open(os.path.join(STATCAN, name)) as f:
        return json.load(f)["features"]


def main():
    cds = load("cd.geojson")
    cd_geoms = [transform(to_albers, shape(f["geometry"])).buffer(0) for f in cds]
    cd_props = [f["properties"] for f in cds]
    tree = STRtree(cd_geoms)

    # FSA -> list of (cduid, land share), largest first.
    shares = {}
    for f in load("fsa.geojson"):
        fsa = f["properties"]["CFSAUID"]
        g = transform(to_albers, shape(f["geometry"])).buffer(0)
        if g.area == 0:
            continue
        parts = []
        for i in tree.query(g):
            a = g.intersection(cd_geoms[i]).area
            if a > 0:
                parts.append((cd_props[i]["CDUID"], a / g.area))
        parts.sort(key=lambda p: -p[1])
        shares[fsa] = parts

    with open(os.path.join(DATA, "postal_counts.csv")) as f:
        postal = [r for r in csv.DictReader(f) if r["country"] == "CA"]

    totals = collections.defaultdict(lambda: collections.Counter())
    crosswalk = []
    unplaced = collections.Counter()
    for r in postal:
        fsa = r["postal_code"]
        source, parts = "fsa_boundary_2021", shares.get(fsa)
        if not parts and r["lat"]:
            p = transform(to_albers, Point(float(r["lon"]), float(r["lat"])))
            hits = [i for i in tree.query(p) if cd_geoms[i].contains(p)]
            if hits:
                source, parts = "fsa_point", [(cd_props[hits[0]]["CDUID"], 1.0)]
        if not parts:
            unplaced["fsas"] += 1
            unplaced["responses"] += int(r["total"])
            continue
        cduid = parts[0][0]
        if PROVINCE[cduid[:2]] != r["state"]:
            # The FSA's land is mostly in another province; keep the response
            # in the province the respondent chose by using the largest share
            # there, if any.
            same = [p for p in parts if PROVINCE[p[0][:2]] == r["state"]]
            if not same:
                unplaced["fsas"] += 1
                unplaced["responses"] += int(r["total"])
                continue
            cduid = same[0][0]
        crosswalk.append({
            "postal_code": fsa,
            "province": r["state"],
            "cduid": cduid,
            "share": f"{dict(parts)[cduid]:.3f}",
            "n_divisions": len(parts),
            "source": source,
        })
        for k in ["total"] + TERMS:
            totals[cduid][k] += int(r[k])

    with open(os.path.join(DATA, "fsa_census_division.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(crosswalk[0]))
        w.writeheader()
        w.writerows(sorted(crosswalk, key=lambda r: r["postal_code"]))

    with open(os.path.join(DATA, "census_division_counts.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cduid", "province", "cd_name", "cd_type", "total"] + TERMS)
        for p in sorted(cd_props, key=lambda p: p["CDUID"]):
            c = totals.get(p["CDUID"], collections.Counter())
            w.writerow([p["CDUID"], PROVINCE[p["PRUID"]], " ".join(p["CDNAME"].split()),
                        CD_TYPE.get(p["CDTYPE"], p["CDTYPE"]), c["total"]]
                       + [c[t] for t in TERMS])

    # Slim copy for conversion to TopoJSON.
    slim = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": p["CDUID"],
         "properties": {"cduid": p["CDUID"], "province": PROVINCE[p["PRUID"]],
                        "name": " ".join(p["CDNAME"].split())},
         "geometry": f["geometry"]}
        for f, p in zip(cds, cd_props)]}
    with open(os.path.join(STATCAN, "cd_for_topojson.geojson"), "w") as f:
        json.dump(slim, f)

    placed = sum(c["total"] for c in totals.values())
    print(f"{len(crosswalk)} FSAs placed in {len(totals)} of {len(cd_props)} divisions, "
          f"{placed} responses; {unplaced['fsas']} FSAs ({unplaced['responses']} responses) unplaced")
    split = [r for r in crosswalk if r["n_divisions"] > 1]
    print(f"{len(split)} FSAs span more than one division; "
          f"{sum(float(r['share']) < 0.5 for r in split)} have under half their land in the chosen one")


if __name__ == "__main__":
    main()
