#!/usr/bin/env python3
"""Clean and anonymize the raw Pop vs Soda survey log.

Reads the private raw files in datadir/ (gitignored) and writes:

  data/postal_counts.csv        responses aggregated by US ZIP / Canadian FSA,
                                with centroid coordinates
  data/county_counts.csv        responses aggregated by US county FIPS
  data/state_counts.csv         responses aggregated by state / province
  data/other_answers.csv        the words typed in for "other", by state
  datadir/clean/responses.csv   one row per kept response, anonymized (no names/
                                emails/IPs/cities) but kept local, not published
  datadir/clean/audit.csv       PRIVATE: every raw line number with the reason
                                it was kept or dropped, for review

Inputs:
  datadir/data       the survey log (name:email:term:other:city:state:zip: date)
  datadir/iplog      submission timestamp -> IP, used only for de-duplication
  datadir/reference/tab20_zcta520_county20_natl.txt
                     Census 2020 ZCTA-to-county relationship file
                     https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/
  datadir/reference/2020_Gaz_zcta_national.txt
                     Census 2020 ZCTA gazetteer (internal points)
                     https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/
  datadir/reference/fsa/CA.txt
                     GeoNames Canadian FSA coordinates (CC BY 4.0)
                     https://download.geonames.org/export/zip/CA.zip
  datadir/reference/legacy/slimzip.txt, slimpc.txt   (optional)
                     The project's original circa-1997 point lists, "code lat lon"
                     with coordinates in hundredths of a degree (+3359 = 33.59).
                     slimzip.txt covers US ZIP codes; slimpc.txt covers BC postal
                     codes, averaged here into FSA points. Used only for codes
                     the current sources lack (mostly retired ZIP codes).

Run from the repo root:  python3 scripts/clean_survey_data.py
"""
import collections
import csv
import math
import datetime
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "datadir")
OUT = os.path.join(ROOT, "data")
AUDIT = os.path.join(RAW, "clean")
ZCTA_FILE = os.path.join(RAW, "reference", "tab20_zcta520_county20_natl.txt")
GAZETTEER_FILE = os.path.join(RAW, "reference", "2020_Gaz_zcta_national.txt")
FSA_FILE = os.path.join(RAW, "reference", "fsa", "CA.txt")
LEGACY_ZIP_FILE = os.path.join(RAW, "reference", "legacy", "slimzip.txt")
LEGACY_PC_FILE = os.path.join(RAW, "reference", "legacy", "slimpc.txt")


def read_legacy(path):
    """Yield (code, lat, lon) from a circa-1997 point list (hundredths of a degree)."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            parts = line.split()
            if len(parts) == 3:
                yield parts[0], int(parts[1]) / 100, int(parts[2]) / 100


def load_points():
    """(country, postal_code) -> (lat, lon, source). Later sources win."""
    pts = {}
    for code, lat, lon in read_legacy(LEGACY_ZIP_FILE):
        pts[("US", code.zfill(5))] = (lat, lon, "legacy_1997")
    fsa = collections.defaultdict(list)
    for code, lat, lon in read_legacy(LEGACY_PC_FILE):
        fsa[code[:3]].append((lat, lon))
    for code, ll in fsa.items():
        pts[("CA", code)] = (round(sum(p[0] for p in ll) / len(ll), 4),
                             round(sum(p[1] for p in ll) / len(ll), 4), "legacy_1997")
    with open(GAZETTEER_FILE, encoding="utf-8-sig") as f:
        for row in csv.reader(f, delimiter="\t"):
            if row[0] == "GEOID":
                continue
            pts[("US", row[0])] = (float(row[5]), float(row[6].strip()), "census_2020_zcta")
    with open(FSA_FILE, encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="\t"):
            pts[("CA", row[1])] = (float(row[9]), float(row[10]), "geonames_fsa")
    # A handful of the 1997 points are far off (e.g. a Vermont ZIP placed in
    # another state). Keep a legacy ZIP point only if it lies near a current
    # ZIP point sharing its 3-digit prefix.
    current = collections.defaultdict(list)
    for (country, code), (lat, lon, src) in pts.items():
        if src == "census_2020_zcta":
            current[code[:3]].append((lat, lon))
    for key, (lat, lon, src) in list(pts.items()):
        if key[0] == "US" and src == "legacy_1997":
            peers = current.get(key[1][:3], [])
            if not any(km_between((lat, lon), q) <= LEGACY_MAX_KM for q in peers):
                del pts[key]
    return pts


LEGACY_MAX_KM = 150


def km_between(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))

TERMS = {"pop", "soda", "coke", "other"}

STATE_FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
    "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
    "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
    "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
    "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
    "55": "WI", "56": "WY", "72": "PR",
}
US_STATES = set(STATE_FIPS.values()) | {"GU", "VI", "AS", "MP"}
# ZIP3 prefixes for territories not covered by the ZCTA file
TERRITORY_ZIP3 = {"969": {"GU", "MP", "AS"}, "008": {"VI"}, "967": {"AS"}}

# Canada Post's postal code for Santa Claus (H0H 0H0, "the North Pole").
FAKE_FSA = "H0H"
PROVINCE_ALIASES = {"NF": "NL", "PQ": "QC"}
CA_PROVINCES = {"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"}
POSTAL_FIRST_LETTER = {
    "A": {"NL"}, "B": {"NS"}, "C": {"PE"}, "E": {"NB"}, "G": {"QC"}, "H": {"QC"},
    "J": {"QC"}, "K": {"ON"}, "L": {"ON"}, "M": {"ON"}, "N": {"ON"}, "P": {"ON"},
    "R": {"MB"}, "S": {"SK"}, "T": {"AB"}, "V": {"BC"}, "X": {"NT", "NU"}, "Y": {"YT"},
}

# --- "other" free text ------------------------------------------------------

# A typed-in "other" answer must look like a word for a soft drink to count as a
# genuine response. Joke answers, insults and raid copypasta are dropped.
BEVERAGE = re.compile(
    r"sod|pop|drink|drank|tonic|cola|coke|coca|fizz|bever|pepsi|pepper|dew|sprite|"
    r"faygo|moxie|refresc|gaseos|phosph|seltzer|\bales?\b|ginger|beer|carbon|bubbl|"
    r"soft|\bdopes?\b|juice|water|mineral|limon|lemon|squash|7 ?up|\brc\b|nehi|jolt|"
    r"belly ?wash|sasp|sarsa|brand|name|cold|sweet|sugar|sody|sodie|soder|frisdrank|"
    r"brus|sodavand|limo|kofola|cool ?drink|fountain|mixer|minerale|diet|caffein|"
    r"refresh|boisson|gazeuse|gaseuse|fresca|fanta|\bfris|kola|sprudel|toinc|tonnic|"
    r"coler|coka|big red|sassafras|egg cream|\bboth\b|all (of )?(the )?above"
)
PROFANE = re.compile(
    r"jizz|jiz\b|\bcum\b|semen|seemen|sperm|penis|\bdicks?\b|cock|shit|fuck|piss|\bass\b|"
    r"asses\b|\bpoop|\bpoo\b|\bcrap\b|nigg|\bfag|retard|whore|slut|splooge|dildo|tubgirl|"
    r"\bgay\b|hitler|\baids\b|porn|\bsex\b|\brape|\banal\b|boob|\btits?\b|vagina|pussy|"
    r"\bbutt\b|chode|choad|urine|\bpee\b|\bballs?\b|gravy|bitch|damn|\bhell\b|\bsucks?\b|"
    r"stupid|idiot|moron|\bdumb|scrotum|testic|\bturd|\bfart|\bweed\b|\bcrack\b|\bmeth\b|"
    r"\bkill|nazi|\bjew\b|\bspic\b|chink|\bkike|wetback|redneck|\bhicks?\b|poon|twat|"
    r"\bfap\b|meatspin|cunt|titt|cocaine|\bbong\b|sewage|select .* from"
)
MAX_OTHER_WORDS = 4
# Only publish typed-in text that at least this many kept responses share; rarer
# one-offs often contain personal names, so the vote is kept but the text blanked.
MIN_OTHER_TEXT_COUNT = 3
OTHER_TEXT_BLOCKLIST = {"taira mcfizzle", "pimp juice", "jesus juice"}  # a name, and two joke answers

NAMED_DUP_WINDOW = datetime.timedelta(hours=24)
ANON_DUP_WINDOW = datetime.timedelta(minutes=10)


def norm_text(s):
    s = s.lower().replace("-", " ")
    s = re.sub(r"[^a-z0-9 ]+", "", s)
    return re.sub(r"\s+", " ", s).strip()


TEST_NAME = re.compile(r"\btest(o|acct|ing)?\b|mctest|o'testo|testossen|^test$", re.I)
TEST_EMAIL = re.compile(r"^test@", re.I)
TEST_CITY = re.compile(r"^testtown$", re.I)

LINE = re.compile(
    r"^(?P<name>[^:]*):(?P<email>.*):(?P<term>[^:]*):(?P<other>[^:]*):(?P<city>[^:]*):"
    r"(?P<state>[^:]*):(?P<zip>[^:]*):\s*(?P<date>\w{3} \w{3} +\d+ \d\d:\d\d:\d\d \d{4})?\s*$"
)


def parse_time(s):
    return datetime.datetime.strptime(" ".join(s.split()), "%a %b %d %H:%M:%S %Y")


def load_iplog():
    by_time = collections.defaultdict(set)
    with open(os.path.join(RAW, "iplog"), encoding="latin-1") as f:
        for line in f:
            p = line.split()
            if len(p) >= 6:
                try:
                    by_time[parse_time(" ".join(p[:5]))].add(p[5])
                except ValueError:
                    pass
    return by_time


def load_zcta():
    """ZCTA -> (county FIPS with the largest land-area share, set of states)."""
    best = {}
    states = collections.defaultdict(set)
    with open(ZCTA_FILE, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter="|"):
            z, county = row["GEOID_ZCTA5_20"], row["GEOID_COUNTY_20"]
            if not z:
                continue
            area = int(row["AREALAND_PART"] or 0)
            if z not in best or area > best[z][1]:
                best[z] = (county, area)
            st = STATE_FIPS.get(county[:2])
            if st:
                states[z].add(st)
    zip3 = collections.defaultdict(set)
    for z, sts in states.items():
        zip3[z[:3]] |= sts
    for p, sts in TERRITORY_ZIP3.items():
        zip3[p] |= sts
    return {z: c for z, (c, _) in best.items()}, states, zip3


def load_county_names():
    """County FIPS -> name ("Baldwin County") from the relationship file."""
    names = {}
    with open(ZCTA_FILE, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter="|"):
            names[row["GEOID_COUNTY_20"]] = row["NAMELSAD_COUNTY_20"]
    return names


def resolve_location(state, raw_zip, zcta_county, zcta_states, zip3_states):
    """Return (country, state, zip, county_fips, quality) or None if bot garbage."""
    st = PROVINCE_ALIASES.get(state.strip().upper(), state.strip().upper())
    z = raw_zip.strip().upper()
    compact = re.sub(r"[\s\-.]", "", z)

    if st in US_STATES:
        if sum(c.isalpha() for c in compact) >= 3:
            return None  # random-letter "ZIP" from spam bots
        m = re.match(r"^(\d{4,5})(\d{4})?$", compact)
        if not m:
            return ("US", st, "", "", "state_only")
        z5 = m.group(1).zfill(5)
        if z5 in zcta_states:
            if st in zcta_states[z5]:
                return ("US", st, z5, zcta_county[z5], "county")
            return ("US", st, "", "", "zip_state_mismatch")
        if st in zip3_states.get(z5[:3], ()):
            return ("US", st, z5, "", "zip_not_in_census")
        return ("US", st, "", "", "zip_state_mismatch")

    if st in CA_PROVINCES:
        if compact.startswith(FAKE_FSA):
            return None
        m = re.match(r"^([A-Z]\d[A-Z])(\d[A-Z]\d)?$", compact)
        if m and st in POSTAL_FIRST_LETTER.get(compact[0], ()):
            return ("CA", st, m.group(1), "", "postal_fsa")
        if sum(c.isalpha() for c in compact) >= 3 and not m:
            return None
        return ("CA", st, "", "", "state_only")

    if st:
        return None  # not a real state/province code
    return ("", "", "", "", "no_location")


def main():
    iplog = load_iplog()
    zcta_county, zcta_states, zip3_states = load_zcta()

    rows = []
    with open(os.path.join(RAW, "data"), encoding="latin-1") as f:
        for i, line in enumerate(f, start=1):
            m = LINE.match(line.rstrip("\n"))
            r = {"line": i, "reason": None}
            if not m or m["term"] not in TERMS:
                r["reason"] = "unparseable"
                rows.append(r)
                continue
            r.update(m.groupdict())
            r["t"] = parse_time(r["date"]) if r["date"] else None
            ips = iplog.get(r["t"], set()) if r["t"] else set()
            r["ip"] = next(iter(ips)) if len(ips) == 1 else None
            rows.append(r)

    parsed = [r for r in rows if not r["reason"]]

    # 1. test entries
    for r in parsed:
        if TEST_NAME.search(r["name"]) or TEST_EMAIL.search(r["email"]) or TEST_CITY.search(r["city"].strip()):
            r["reason"] = "test_entry"

    # 2. "other" text: genuine, redacted, or spam
    other_counts = collections.Counter(
        norm_text(r["other"]) for r in parsed if r["term"] == "other" and not r["reason"]
    )
    for r in parsed:
        r["other_text"] = ""
        if r["reason"] or r["term"] != "other":
            continue
        t = norm_text(r["other"])
        if not t:
            continue
        if PROFANE.search(t) or not BEVERAGE.search(t):
            r["reason"] = "spam_other_text"
        elif len(t.split()) > MAX_OTHER_WORDS:
            if other_counts[t] >= 3:
                r["reason"] = "spam_copypasta"
            # otherwise a genuine long comment: keep the vote, drop the text
        else:
            r["other_text"] = t

    # 3. location
    for r in parsed:
        if r["reason"]:
            continue
        loc = resolve_location(r["state"], r["zip"], zcta_county, zcta_states, zip3_states)
        if loc is None:
            r["reason"] = "invalid_location"
        else:
            r["country"], r["st"], r["zip_out"], r["county"], r["loc_quality"] = loc

    # 4. duplicates / repeat votes
    seen = {}
    for r in parsed:
        if r["reason"]:
            continue
        who = (norm_text(r["name"]), r["email"].strip().lower())
        content = (r["term"], norm_text(r["other"]), r["st"], r["zip_out"] or norm_text(r["city"]))
        if r["ip"]:
            key = ("ip", r["ip"]) + who + content
            if key in seen:
                r["reason"] = "duplicate_same_ip"
                continue
            seen[key] = r["t"]
        else:
            key = ("noip",) + who + content + (norm_text(r["city"]),)
            prev = seen.get(key)
            # Without an IP, two anonymous identical votes hours apart are as likely
            # to be two neighbours as one person, so only collapse quick repeats.
            window = NAMED_DUP_WINDOW if who != ("", "") else ANON_DUP_WINDOW
            if prev is not None and r["t"] and prev and (r["t"] - prev) < window:
                r["reason"] = "duplicate_no_ip"
                continue
            if prev is None and not r["t"] and who != ("", ""):
                # undated (pre-2000) named entry: dedupe on exact content
                if key in seen:
                    r["reason"] = "duplicate_no_ip"
                    continue
            seen[key] = r["t"]

    # 5. anonymous floods: an IP sending many nameless votes for one term in a day
    by_ip_day = collections.defaultdict(list)
    for r in parsed:
        if not r["reason"] and r["ip"]:
            by_ip_day[(r["ip"], r["t"].date())].append(r)
    for group in by_ip_day.values():
        if len(group) < 10:
            continue
        anon = sum(1 for r in group if not r["name"].strip() and not r["email"].strip())
        top = collections.Counter(r["term"] for r in group).most_common(1)[0][1]
        if anon >= 0.9 * len(group) and top >= 0.9 * len(group):
            for r in group[1:]:
                r["reason"] = "ip_flood"

    for r in parsed:
        if not r["reason"]:
            r["reason"] = "kept"

    # --- outputs -----------------------------------------------------------
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(AUDIT, exist_ok=True)

    kept = [r for r in parsed if r["reason"] == "kept"]
    kept.sort(key=lambda r: (r["t"] or datetime.datetime.min, r["line"]))
    text_counts = collections.Counter(r["other_text"] for r in kept if r["other_text"])
    for r in kept:
        if text_counts[r["other_text"]] < MIN_OTHER_TEXT_COUNT or r["other_text"] in OTHER_TEXT_BLOCKLIST:
            r["other_text"] = ""
    with open(os.path.join(AUDIT, "responses.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "date", "term", "other_text", "country", "state", "postal_code", "county_fips", "location_quality"])
        for n, r in enumerate(kept, start=1):
            w.writerow([
                n, r["t"].date().isoformat() if r["t"] else "", r["term"], r["other_text"],
                r["country"], r["st"], r["zip_out"], r["county"], r["loc_quality"],
            ])

    counts = collections.defaultdict(collections.Counter)
    for r in kept:
        if r["county"]:
            counts[r["county"]][r["term"]] += 1
    county_names = load_county_names()
    with open(os.path.join(OUT, "county_counts.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["county_fips", "county_name", "total", "pop", "soda", "coke", "other"])
        for fips in sorted(counts):
            c = counts[fips]
            w.writerow([fips, county_names.get(fips, ""), sum(c.values()), c["pop"], c["soda"], c["coke"], c["other"]])

    # Every kept response counts toward its state, whatever its ZIP code. Rows
    # with no state at all are totalled under a blank country and state.
    states = collections.defaultdict(collections.Counter)
    for r in kept:
        states[(r["country"], r["st"])][r["term"]] += 1
    with open(os.path.join(OUT, "state_counts.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["country", "state", "total", "pop", "soda", "coke", "other"])
        for key in sorted(states):
            c = states[key]
            w.writerow([*key, sum(c.values()), c["pop"], c["soda"], c["coke"], c["other"]])

    # Typed-in "other" answers, already normalized and spam-filtered, and only
    # those given at least MIN_OTHER_TEXT_COUNT times overall.
    answers = collections.Counter(
        (r["country"], r["st"], r["other_text"]) for r in kept if r["other_text"]
    )
    with open(os.path.join(OUT, "other_answers.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["country", "state", "answer", "count"])
        for key, n in sorted(answers.items(), key=lambda kv: (kv[0][0], kv[0][1], -kv[1], kv[0][2])):
            w.writerow([*key, n])

    # Finest spatial unit we have: US ZIP code / Canadian FSA. A ZIP code whose
    # state disagrees with the respondent's has no postal_code, so it isn't included.
    postal = collections.defaultdict(collections.Counter)
    postal_county = {}
    for r in kept:
        if r["zip_out"]:
            key = (r["country"], r["st"], r["zip_out"])
            postal[key][r["term"]] += 1
            postal_county[key] = r["county"]
    points = load_points()
    missing = collections.Counter()
    with open(os.path.join(OUT, "postal_counts.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["country", "state", "postal_code", "county_fips", "lat", "lon", "coord_source",
                    "total", "pop", "soda", "coke", "other"])
        for key in sorted(postal):
            c = postal[key]
            lat, lon, src = points.get((key[0], key[2]), ("", "", ""))
            if not src:
                missing[key[0]] += 1
            w.writerow([*key, postal_county[key], lat, lon, src,
                        sum(c.values()), c["pop"], c["soda"], c["coke"], c["other"]])
    print("postal codes without coordinates:", dict(missing))

    with open(os.path.join(AUDIT, "audit.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["line", "reason", "term", "ip"])
        for r in rows:
            w.writerow([r["line"], r["reason"], r.get("term", ""), r.get("ip") or ""])

    reasons = collections.Counter(r["reason"] for r in rows)
    print(f"raw lines: {len(rows)}")
    for k, v in reasons.most_common():
        print(f"  {k:22s} {v:7d}")
    q = collections.Counter(r["loc_quality"] for r in kept)
    print("kept by location quality:", dict(q.most_common()))
    print("kept by term:", dict(collections.Counter(r["term"] for r in kept).most_common()))


if __name__ == "__main__":
    sys.exit(main())
