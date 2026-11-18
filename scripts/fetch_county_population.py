#!/usr/bin/env python3
"""Write data/county_population_2010.csv: 2010 Census population by county.

The 2010 census falls in the middle of the survey's run, and its county
codes match the older county map in d3/us.json. The map has a few codes for
Alaska areas that were split up in 2007-08; those get the sum of their
successors.

Source (public domain): U.S. Census Bureau, County Intercensal Estimates
2000-2010, column CENSUS2010POP
https://www2.census.gov/programs-surveys/popest/datasets/2000-2010/intercensal/county/co-est00int-tot.csv

Run from the repo root:  python3 scripts/fetch_county_population.py
"""
import csv
import io
import os
import urllib.request

URL = ("https://www2.census.gov/programs-surveys/popest/datasets/2000-2010/"
       "intercensal/county/co-est00int-tot.csv")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "data", "county_population_2010.csv")

# Pre-2008 Alaska codes still in d3/us.json -> the 2010 areas that replaced them.
ALASKA_PREDECESSORS = {
    "02201": ["02198"],           # Prince of Wales-Outer Ketchikan -> Prince of Wales-Hyder
    "02232": ["02105", "02230"],  # Skagway-Hoonah-Angoon -> Hoonah-Angoon, Skagway
    "02280": ["02195", "02275"],  # Wrangell-Petersburg -> Petersburg, Wrangell
}


def main():
    with urllib.request.urlopen(URL) as resp:
        text = resp.read().decode("latin-1")
    pop, names = {}, {}
    for r in csv.DictReader(io.StringIO(text)):
        if r["SUMLEV"] != "50":
            continue
        fips = f"{int(r['STATE']):02d}{int(r['COUNTY']):03d}"
        pop[fips] = int(r["CENSUS2010POP"])
        names[fips] = f"{r['CTYNAME']}, {r['STNAME']}"
    for old, new in ALASKA_PREDECESSORS.items():
        pop[old] = sum(pop[c] for c in new)
        names[old] = " + ".join(names[c].split(",")[0] for c in new) + ", Alaska"
    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["county_fips", "name", "population_2010"])
        for fips in sorted(pop):
            w.writerow([fips, names[fips], pop[fips]])
    print(f"wrote {len(pop)} counties to {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
