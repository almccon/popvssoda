# Pop vs Soda survey data (cleaned and anonymized)

These files come from the raw Pop vs Soda survey log, which ran from the late
1990s until submissions were turned off on 2015-08-31. The script
`scripts/clean_survey_data.py` builds them from the private raw files in
`datadir/`, which are not in the repository. Only aggregate counts are
published here. The script also writes an anonymized response-level file to
`datadir/clean/responses.csv`, which stays local.

## `postal_counts.csv`

This is the finest spatial resolution available: responses totalled by US ZIP
code or Canadian forward sortation area (FSA). 

| column | description |
|---|---|
| `country` | `US` or `CA` |
| `state` | Two-letter state, territory or province code |
| `postal_code` | 5-digit ZIP code, or 3-character FSA |
| `county_fips` | US only. Assigned using the 2020 Census ZCTA-to-county relationship file; where a ZIP code spans several counties, it goes to the county with the largest share of its land area. It is blank when the ZIP code isn't in the 2020 census. |
| `lat`, `lon` | A representative point for the area (WGS84) |
| `coord_source` | `census_2020_zcta`: the internal point from the Census 2020 ZCTA Gazetteer. `geonames_fsa`: an FSA centroid from GeoNames. `legacy_1997`: the project's original circa-1997 ZIP point list, used only for codes not in the 2020 gazetteer (mostly retired ZIP codes). A legacy point is only used when it lies within 150 km of a current ZIP code with the same 3-digit prefix, which screens out the few that were badly placed. Blank: no coordinates found. |
| `total`, `pop`, `soda`, `coke`, `other` | Response counts |

The file includes every ZIP code that is valid for the respondent's state,
including retired and PO-box ZIP codes that aren't in the 2020 census. Responses
whose ZIP code didn't match their state aren't included.

About 1,500 US ZIP codes (about 2,000 responses, under 1%) and 42 FSAs have no
coordinates. Most of the ZIP codes are PO-box or unique-organization codes,
which have no area of their own. The FSAs are a mix of codes that don't exist
(such as M2I and K2O), retired codes, and rural codes that GeoNames doesn't
list (such as E0A–E0J in New Brunswick and B0A in Nova Scotia).

Most ZIP codes have only a few responses (the median is 4), so smooth or
aggregate before mapping rates.

## `county_counts.csv`

This file has response totals by US county FIPS code, with the county's 2020
Census name (`county_name`) and the columns `total`, `pop`, `soda`, `coke` and
`other`. Only responses whose ZIP code is in the 2020 census and matches their
state are counted. The county assignment is the same as in `postal_counts.csv`.

## `state_counts.csv`

This file has response totals by state, province or territory (`country`,
`state`, then the same count columns). Every kept response counts toward the
state the respondent chose, including those without a usable ZIP code, so these
totals are larger than the sums of the other files. The row with a blank
country and state counts responses that gave no location.

## `other_answers.csv`

This file lists what people typed in when they chose "other", by state
(`country`, `state`, `answer`, `count`). Answers are lowercased with punctuation
removed, so similar spellings group together. Only answers given at least 3
times in the whole survey are included, because rarer ones can contain
people's names. Long comments and spam aren't included either.

These two files are used to build the statistics pages in `statistics/`
(`python3 scripts/build_statistics.py`).

## What was removed

The cleaning script drops the following kinds of rows.

- **Repeat votes.** These are identical responses from the same IP address. The
  IP log covers March 2003 onward; it is used only for this matching and is not
  published. Before that, identical anonymous responses are dropped when they
  fall within 10 minutes of each other. Identical named responses are dropped
  when they fall within 24 hours of each other.
- **Ballot stuffing.** These are bursts from one IP address on one day: at least
  10 votes, at least 90% of them anonymous, with at least 90% for the same term.
  The largest came from one IP address that sent about 8,700 "soda" votes for
  Kalamazoo, MI in June 2008.
- **Spam "other" answers.** These are typed-in answers that aren't a word for a
  soft drink or that contain obscenities or slurs. They include joke raids such
  as "jamieW", "tarzan slam" and "WoFat", and random-letter bot text. Long
  pasted text that repeats 3 or more times is also dropped.
- **Bot submissions.** These have a state code that isn't real, or random letters
  in the ZIP code field.
- **Fake locations.** One respondent gave Santa Claus's postal code, H0H 0H0
  (the "North Pole").
- **Test entries and corrupted lines.**

Genuine long comments in the "other" box are kept as "other" votes.

## Sources

- U.S. Census Bureau, 2020 ZCTA-to-county relationship file and 2020 ZCTA
  Gazetteer (public domain).
- Canadian FSA coordinates from [GeoNames](https://www.geonames.org/), licensed
  under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Notes

- Respondents chose to take the survey; they are not a random sample.
- About 100k responses are from 2002 (the survey went viral in September 2002),
  and 2013 has another spike, so the totals lean toward those years.
- County codes follow the 2020 Census, so they include the Alaska boroughs
  created after 2000. They may not all match the older `d3/us.json`.
