Pop vs Soda
=========

The Pop vs Soda Page is a linguistic survey created by [Alan McConchie](https://github.com/almccon) and hosted at http://popvssoda.com.

## Layout

- `index.html`, `js/map.js`, `css/style.css`: the interactive county map.
- `vendor/`: vendored copies of [D3](https://d3js.org) v7.9.0 and [topojson-client](https://github.com/topojson/topojson-client) v3.1.0.
- `d3/us.json`: US county, state and land boundaries (TopoJSON).
- `d3/pvscounty_fips.tsv`: survey responses aggregated by county (joined on the `id` column, the county FIPS code).
- `archive/`: earlier versions of the page.

## Running locally

The page loads its data with `fetch`, so it needs to be served over HTTP rather than opened as a file:

    python3 -m http.server

Then open http://localhost:8000.
