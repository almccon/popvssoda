#!/usr/bin/env python3
"""Write data/census_division_population_2010.csv: population by Canadian
census division, July 1, 2010.

2010 pairs with the US county populations (2010 Census) and falls in the
middle of the survey's run. These are Statistics Canada's population
estimates on 2021 census division boundaries, so the codes (cduid) match
d3/canada.json and data/census_division_counts.csv exactly.

Source: Statistics Canada, Table 17-10-0152-01, Population estimates,
July 1, by census division, 2021 boundaries. Statistics Canada Open Licence.
https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1710015201

The full table (about 32 MB zipped) is cached in datadir/reference/statcan/.
If Python can't verify Statistics Canada's certificate, download it there
with curl first:
  curl -A Mozilla/5.0 -o datadir/reference/statcan/17100152-eng.zip \
    https://www150.statcan.gc.ca/n1/tbl/csv/17100152-eng.zip

Run from the repo root:  python3 scripts/fetch_canada_population.py
"""
import csv
import io
import os
import re
import urllib.request
import zipfile

YEAR = "2010"
URL = "https://www150.statcan.gc.ca/n1/tbl/csv/17100152-eng.zip"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "datadir", "reference", "statcan", "17100152-eng.zip")
OUT = os.path.join(ROOT, "data", "census_division_population_2010.csv")


def main():
    if not os.path.exists(CACHE):
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp, open(CACHE, "wb") as f:
            f.write(resp.read())

    rows = {}
    with zipfile.ZipFile(CACHE) as z:
        with z.open("17100152.csv") as raw:
            for r in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")):
                if r["REF_DATE"] != YEAR or r["Gender"] != "Total - gender" or r["Age group"] != "All ages":
                    continue
                # DGUID ends in the 4-digit census division code, e.g. 2021A00031001.
                m = re.fullmatch(r"2021A0003(\d{4})", r["DGUID"])
                if not m or not r["VALUE"]:
                    continue
                rows[m.group(1)] = (r["GEO"], int(float(r["VALUE"])))

    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cduid", "name", f"population_{YEAR}"])
        for cduid in sorted(rows):
            w.writerow([cduid, *rows[cduid]])
    print(f"{len(rows)} census divisions, total {sum(p for _, p in rows.values()):,} -> {OUT}")


if __name__ == "__main__":
    main()
