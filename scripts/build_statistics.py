#!/usr/bin/env python3
"""Build the static statistics pages in statistics/ from the published data.

Reads only public files:
  data/state_counts.csv, data/county_counts.csv, data/other_answers.csv

Writes one page per state, province and territory (statistics/MA.html etc.),
plus the summary pages the old site had: ALL.html (every state and province),
USA.html, CAN.html, TOTAL.html (every "other" answer) and XX.html (responses
with no location). The file names match the pre-2026 pages so old links keep
working; index.html is a copy of ALL.html.

Also writes countystats/XX-stats.html for each US state and DC, matching the
old county pages' addresses, and countystats/index.html listing them.

Run from the repo root:  python3 scripts/build_statistics.py
"""
import collections
import csv
import html
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "statistics")
COUNTY_OUT = os.path.join(ROOT, "countystats")

TERMS = ["pop", "soda", "coke", "other"]
LABEL = {"pop": "Pop", "soda": "Soda", "coke": "Coke", "other": "Other"}
REPO_DATA = "https://github.com/almccon/popvssoda/tree/master/data"

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
US_TERRITORIES = {"AS": "American Samoa", "GU": "Guam", "PR": "Puerto Rico", "VI": "U.S. Virgin Islands"}
CA_PROVINCES = {
    "AB": "Alberta", "BC": "British Columbia", "MB": "Manitoba", "NB": "New Brunswick",
    "NL": "Newfoundland and Labrador", "NS": "Nova Scotia", "ON": "Ontario",
    "PE": "Prince Edward Island", "QC": "Quebec", "SK": "Saskatchewan",
}
CA_TERRITORIES = {"NT": "Northwest Territories", "NU": "Nunavut", "YT": "Yukon"}
NAMES = {**US_STATES, **US_TERRITORIES, **CA_PROVINCES, **CA_TERRITORIES}
# The old site used the pre-2001 code NF for Newfoundland; keep its file name.
PAGE = {code: ("NF" if code == "NL" else code) + ".html" for code in NAMES}

STATE_FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
    "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
    "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
    "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
    "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
    "55": "WI", "56": "WY", "60": "AS", "66": "GU", "72": "PR", "78": "VI",
}

esc = html.escape


def fmt(n):
    return f"{n:,}"


def pct(part, whole):
    if not whole:
        return "–"
    if not part:
        return "0%"
    v = 100 * part / whole
    return f"{v:.1f}%" if v < 10 else f"{v:.0f}%"


def ordinal(n):
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


class Counts:
    def __init__(self, row=None):
        self.c = {t: int(row[t]) if row else 0 for t in TERMS}

    def __iadd__(self, other):
        for t in TERMS:
            self.c[t] += other.c[t]
        return self

    @property
    def total(self):
        return sum(self.c.values())

    def share(self, t):
        return self.c[t] / self.total if self.total else 0

    def top(self):
        return max(TERMS, key=lambda t: self.c[t])


def read_csv(name):
    with open(os.path.join(DATA, name), newline="") as f:
        return list(csv.DictReader(f))


def bar(counts, label=None):
    """A stacked bar of the four shares."""
    parts = "".join(
        f'<span class="seg {t}" style="width:{100 * counts.share(t):.2f}%"></span>'
        for t in TERMS if counts.c[t]
    )
    aria = label or ", ".join(f"{LABEL[t]} {pct(counts.c[t], counts.total)}" for t in TERMS)
    return f'<span class="bar" role="img" aria-label="{esc(aria)}">{parts}</span>'


def key():
    return '<p class="term-key">' + "".join(
        f'<span><span class="dot {t}"></span>{LABEL[t]}</span>' for t in TERMS) + "</p>"


def page(filename, title, body, canonical=None, out_dir=OUT):
    # Pages outside statistics/ (the county pages) link back into it.
    sp = "" if out_dir == OUT else "../statistics/"
    head_extra = f'\n\t<link rel="canonical" href="{canonical}">' if canonical else ""
    nav = [
        ("../index.html", "← Main map"),
        (sp + "ALL.html", "All states and provinces"),
        (sp + "USA.html", "United States"),
        (sp + "CAN.html", "Canada"),
        ("../countystats/" if out_dir == OUT else "index.html", "Counties"),
        (sp + "TOTAL.html", "“Other” answers"),
        (sp + "XX.html", "No location"),
    ]
    current = ' aria-current="page"'
    nav_html = "\n".join(
        f'\t\t<a href="{href}"{current if href == filename else ""}>{text}</a>'
        for href, text in nav)
    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>{esc(title)} – Pop vs Soda statistics</title>{head_extra}
	<link href="../css/style.css" rel="stylesheet">
	<link href="{sp}statistics.css" rel="stylesheet">
	<script src="{sp}statistics.js" defer></script>
</head>
<body>
	<header>
		<h1><a href="../index.html"><img src="../images/popvssoda title.png" width="282" height="55" alt="Pop vs Soda"></a></h1>
	</header>
	<nav class="stats-nav" aria-label="Statistics">
{nav_html}
	</nav>
	<main>
{body}
	</main>
	<footer>
		The survey ran from the late 1990s until August 2015. In 2026 the responses were
		cleaned up: repeat votes, ballot stuffing, spam and bot submissions were removed,
		so these counts are lower than the ones these pages showed before.
		<a href="{REPO_DATA}">Download the data and read how it was cleaned</a>.
	</footer>
</body>
</html>
"""
    with open(os.path.join(out_dir, filename), "w") as f:
        f.write(doc)


# ---- table of places ------------------------------------------------------

def table_head(first):
    cells = "".join(
        f'<th class="num" data-sort="num"><span class="dot {t}"></span>{LABEL[t]}</th>' for t in TERMS)
    return (f'<thead><tr><th data-sort="text">{first}</th>'
            f'<th class="num" data-sort="num">Responses</th>{cells}'
            f'<th class="bar-col">Mix</th></tr></thead>')


def table_row(name, counts, href=None, cls="", with_counts=False):
    """with_counts: show each term's count under its share (the county pages)."""
    link = f'<a href="{href}">{esc(name)}</a>' if href else esc(name)
    cells = "".join(
        f'<td class="num" data-value="{counts.share(t):.6f}" title="{fmt(counts.c[t])} responses">'
        f'{pct(counts.c[t], counts.total)}'
        f'{f"<small>{fmt(counts.c[t])}</small>" if with_counts else ""}</td>' for t in TERMS)
    cls_attr = f' class="{cls}"' if cls else ""
    return (f'<tr{cls_attr}><th scope="row" data-value="{esc(name)}">{link}</th>'
            f'<td class="num" data-value="{counts.total}">{fmt(counts.total)}</td>{cells}'
            f'<td class="bar-col">{bar(counts)}</td></tr>')


def places_table(groups, first="State or province"):
    """groups: list of (heading, [(code, Counts)], subtotal Counts, subtotal label)."""
    out = [f'<div class="table-wrap"><table class="places sortable">{table_head(first)}']
    for heading, rows, sub, sub_label in groups:
        out.append("<tbody>")
        if heading:
            out.append(f'<tr class="group"><th colspan="7">{esc(heading)}</th></tr>')
        for code, c in sorted(rows, key=lambda r: NAMES[r[0]]):
            out.append(table_row(NAMES[code], c, PAGE[code]))
        out.append("</tbody>")
        if sub is not None:
            out.append(f'<tbody class="subtotal">{table_row(sub_label, sub)}</tbody>')
    out.append("</table></div>")
    return "\n".join(out)


# ---- pages ------------------------------------------------------------------

def main():
    os.makedirs(OUT, exist_ok=True)

    state = {}
    no_location = Counts()
    for r in read_csv("state_counts.csv"):
        if r["state"]:
            state[r["state"]] = Counts(r)
        else:
            no_location = Counts(r)
    missing = set(state) - set(NAMES)
    assert not missing, f"no name for {missing}"

    answers = collections.defaultdict(collections.Counter)  # state ("" = none) -> answer -> n
    for r in read_csv("other_answers.csv"):
        answers[r["state"]][r["answer"]] += int(r["count"])

    counties = collections.defaultdict(list)
    for r in read_csv("county_counts.csv"):
        st = STATE_FIPS.get(r["county_fips"][:2])
        if st:
            counties[st].append((r["county_name"] or r["county_fips"], Counts(r)))

    def total_of(codes):
        t = Counts()
        for code in codes:
            if code in state:
                t += state[code]
        return t

    us_codes = [c for c in {**US_STATES, **US_TERRITORIES} if c in state]
    ca_codes = [c for c in {**CA_PROVINCES, **CA_TERRITORIES} if c in state]
    usa, can = total_of(us_codes), total_of(ca_codes)
    everyone = Counts()
    everyone += usa
    everyone += can
    everyone += no_location

    def rows(codes):
        return [(c, state[c]) for c in codes if c in state]

    us_groups = [
        ("States", rows(US_STATES), None, None),
        ("Territories", rows(US_TERRITORIES), usa, "United States"),
    ]
    ca_groups = [
        ("Provinces", rows(CA_PROVINCES), None, None),
        ("Territories", rows(CA_TERRITORIES), can, "Canada"),
    ]

    def summary_panel(title, counts, extra=""):
        top = counts.top()
        return f"""		<section class="panel">
			<h1>{esc(title)}</h1>
			<p class="lede">{fmt(counts.total)} responses{extra}. The most common answer is
			<strong>{LABEL[top].lower()}</strong> ({pct(counts.c[top], counts.total)}).</p>
			{bar(counts)}
			{key()}
		</section>"""

    intro = """			<p>Each row shows how people from that state, province or territory answered.
			Click a name for more detail, including the words typed in for “other” and, for
			US states, a county-by-county breakdown. Click a column heading to sort.</p>"""

    # ALL / index
    all_body = "\n".join([
        summary_panel("Pop vs Soda statistics", everyone, " from the United States, Canada and elsewhere"),
        "\t\t<section class=\"panel\">",
        "\t\t\t<h2>BY STATE AND PROVINCE</h2>",
        intro,
        places_table(
            [(f"United States: {h}", r, s, l) for h, r, s, l in us_groups] +
            [(f"Canada: {h}", r, s, l) for h, r, s, l in ca_groups] +
            [(None, [], no_location, "No location given"), (None, [], everyone, "Everyone")]
        ),
        "\t\t</section>",
    ])
    page("ALL.html", "All states and provinces", all_body)
    page("index.html", "All states and provinces", all_body, canonical="ALL.html")

    page("USA.html", "United States", "\n".join([
        summary_panel("United States", usa, f" ({pct(usa.total, everyone.total)} of all responses)"),
        "\t\t<section class=\"panel\">\n\t\t\t<h2>BY STATE</h2>",
        intro,
        places_table(us_groups, "State or territory"),
        "\t\t</section>",
    ]))
    page("CAN.html", "Canada", "\n".join([
        summary_panel("Canada", can, f" ({pct(can.total, everyone.total)} of all responses)"),
        "\t\t<section class=\"panel\">\n\t\t\t<h2>BY PROVINCE AND TERRITORY</h2>",
        intro,
        places_table(ca_groups, "Province or territory"),
        "\t\t</section>",
    ]))

    # Ranks: among the 50 states + DC, or among the 10 provinces.
    def ranks(codes):
        out = {}
        for t in TERMS:
            order = sorted((c for c in codes if c in state), key=lambda c: -state[c].share(t))
            for i, c in enumerate(order, start=1):
                out[(c, t)] = (i, len(order))
        return out
    rank = {**ranks(US_STATES), **ranks(CA_PROVINCES)}

    def answers_panel(code, counts, place):
        listed = answers.get(code, collections.Counter())
        unlisted = counts.c["other"] - sum(listed.values())
        if not counts.c["other"]:
            return ""
        items = "".join(
            f'<li><span class="n">{fmt(n)}</span> <span class="answer">{esc(a)}</span></li>'
            for a, n in sorted(listed.items(), key=lambda kv: (-kv[1], kv[0])))
        note = (f'{fmt(unlisted)} “other” response{"s" if unlisted != 1 else ""} '
                f'{"aren’t" if unlisted != 1 else "isn’t"} listed: long comments, answers left blank, '
                'and answers given fewer than 3 times in the whole survey, which can include '
                'people’s names. Spam was removed altogether.') if unlisted else ""
        return f"""		<section class="panel">
			<h2>WHAT PEOPLE TYPED IN FOR “OTHER”</h2>
			<p>{fmt(counts.c["other"])} people from {esc(place)} chose “other”. Answers are shown in
			lowercase with punctuation removed, so similar spellings are grouped together.
			<a href="TOTAL.html">See every answer</a>.</p>
			{f'<ol class="answers">{items}</ol>' if items else ""}
			{f'<p class="note">{note}</p>' if note else ""}
		</section>"""

    for code, name in NAMES.items():
        if code not in state:
            continue
        c = state[code]
        is_us = code in US_STATES or code in US_TERRITORIES
        country, country_counts = ("the US", usa) if is_us else ("Canada", can)
        share_all = pct(c.total, everyone.total)
        rows_html = []
        for t in TERMS:
            r = rank.get((code, t))
            rank_cell = f"{ordinal(r[0])} of {r[1]}" if r else "–"
            rows_html.append(
                f'<tr><th scope="row"><span class="dot {t}"></span>{LABEL[t]}</th>'
                f'<td class="num">{fmt(c.c[t])}</td><td class="num">{pct(c.c[t], c.total)}</td>'
                f'<td class="num">{pct(country_counts.c[t], country_counts.total)}</td>'
                f'<td class="num">{rank_cell}</td></tr>')
        rank_label = "Rank among states" if code in US_STATES else "Rank among provinces"
        body = [
            summary_panel(name, c, f" from {esc(name)} ({share_all} of all responses)"),
            f"""		<section class="panel">
			<h2>ANSWERS</h2>
			<div class="table-wrap"><table class="terms">
			<thead><tr><th>Answer</th><th class="num">Responses</th><th class="num">Share</th>
			<th class="num">All of {country}</th><th class="num">{rank_label if code in rank_codes(code) else "Rank"}</th></tr></thead>
			<tbody>{"".join(rows_html)}</tbody>
			<tfoot><tr><th scope="row">Total</th><td class="num">{fmt(c.total)}</td><td class="num">100%</td>
			<td class="num"></td><td class="num"></td></tr></tfoot>
			</table></div>
			<p class="note">The rank compares this {"state" if is_us else "province"}’s share of each
			answer with the other {"50 states and DC" if is_us else "provinces"}: 1st means the highest share.
			{"Territories aren’t ranked." if code not in rank_codes(code) else ""}</p>
		</section>""",
            answers_panel(code, c, name),
        ]
        if counties.get(code):
            cs = sorted(counties[code], key=lambda kv: (-kv[1].total, kv[0]))
            table = [f'<div class="table-wrap"><table class="places sortable">{table_head("County")}<tbody>']
            table += [table_row(n, cc) for n, cc in cs]
            table.append("</tbody></table></div>")
            in_counties = sum(cc.total for _, cc in cs)
            body.append(f"""		<section class="panel">
			<h2>BY COUNTY</h2>
			<p>Responses are placed in a county by ZIP code. Where a ZIP code spans several counties,
			it goes to the one with the most of its land. {fmt(in_counties)} of the {fmt(c.total)}
			responses gave a ZIP code that could be placed. Counties with only a few responses can
			swing a long way by chance.
			<a href="../countystats/{code}-stats.html">See the counts for each county</a>.</p>
			{"".join(table)}
		</section>""")
        page(PAGE[code], name, "\n".join(b for b in body if b))

    # County pages: countystats/XX-stats.html, the old addresses.
    os.makedirs(COUNTY_OUT, exist_ok=True)
    county_index = []
    for code, name in sorted(US_STATES.items(), key=lambda kv: kv[1]):
        if not counties.get(code):
            continue
        c = state[code]
        cs = sorted(counties[code], key=lambda kv: kv[0])
        placed = Counts()
        for _, cc in cs:
            placed += cc
        table = [f'<div class="table-wrap"><table class="places sortable">{table_head("County")}<tbody>']
        table += [table_row(n, cc, with_counts=True) for n, cc in cs]
        table.append(f'</tbody><tfoot>{table_row("All counties", placed, with_counts=True)}</tfoot>'
                     '</table></div>')
        unplaced = c.total - placed.total
        page(f"{code}-stats.html", f"{name} by county", "\n".join([
            summary_panel(f"{name} by county", c, f" from {esc(name)}"),
            f"""		<section class="panel">
			<h2>BY COUNTY</h2>
			<p>Each answer’s share of the responses from that county, with the number of
			responses under it. Click a column heading to sort. Counties with only a few
			responses can swing a long way by chance.</p>
			{"".join(table)}
			<p class="note">Responses are placed in a county by ZIP code. Where a ZIP code spans
			several counties, it goes to the one with the most of its land.
			{f"{fmt(unplaced)} of the {fmt(c.total)} responses from {esc(name)} didn’t give a ZIP code that could be placed, so they aren’t in this table. " if unplaced else ""}
			<a href="../statistics/{PAGE[code]}">More about {esc(name)}</a>, including the
			words typed in for “other”.</p>
		</section>""",
        ]), out_dir=COUNTY_OUT)
        county_index.append(table_row(name, placed, href=f"{code}-stats.html"))
    page("index.html", "Counties", "\n".join([
        summary_panel("Pop vs Soda by county", usa, " from the United States"),
        f"""		<section class="panel">
			<h2>COUNTY PAGES</h2>
			<p>Pick a state for a county-by-county breakdown. The numbers here count only
			responses with a ZIP code that could be placed in a county.</p>
			<div class="table-wrap"><table class="places sortable">{table_head("State")}<tbody>
			{"".join(county_index)}
			</tbody></table></div>
		</section>""",
    ]), out_dir=COUNTY_OUT)

    # TOTAL: every answer, with where it came from.
    by_answer = collections.defaultdict(collections.Counter)
    for st, cnt in answers.items():
        for a, n in cnt.items():
            by_answer[a][st] += n
    listed_total = sum(sum(v.values()) for v in by_answer.values())
    items = []
    for a, where in sorted(by_answer.items(), key=lambda kv: (-sum(kv[1].values()), kv[0])):
        top = where.most_common()
        shown = top[:4]
        places = ", ".join(
            (f'<a href="{PAGE[st]}">{esc(NAMES[st])}</a>' if st else "no location") + f" {fmt(n)}"
            for st, n in shown)
        more = len(top) - len(shown)
        if more:
            places += f", and {more} more place{'s' if more != 1 else ''}"
        items.append(
            f'<tr><td class="num">{fmt(sum(where.values()))}</td>'
            f'<th scope="row" class="answer">{esc(a)}</th><td class="where">{places}</td></tr>')
    page("TOTAL.html", "“Other” answers", "\n".join([
        summary_panel("Every “other” answer", everyone, " in all"),
        f"""		<section class="panel">
			<h2>WHAT PEOPLE TYPED IN FOR “OTHER”</h2>
			<p>{fmt(everyone.c["other"])} people chose “other”. Here are the {len(by_answer)} answers
			given at least 3 times, {fmt(listed_total)} responses in all, with the places they came
			from most. Answers are shown in lowercase with punctuation removed, so similar
			spellings are grouped together. Long comments, rare answers (which can include
			people’s names) and spam aren’t shown.</p>
			<div class="table-wrap"><table class="answer-table">
			<thead><tr><th class="num">Responses</th><th>Answer</th><th>Most common in</th></tr></thead>
			<tbody>{"".join(items)}</tbody></table></div>
		</section>""",
    ]))

    page("XX.html", "No location", "\n".join([
        summary_panel("No location given", no_location,
                      f" from people who didn’t give a state or province ({pct(no_location.total, everyone.total)} of all responses)"),
        answers_panel("", no_location, "no location"),
    ]))

    print(f"wrote {len(os.listdir(OUT))} files to {os.path.relpath(OUT, ROOT)}/ "
          f"and {len(os.listdir(COUNTY_OUT))} to {os.path.relpath(COUNTY_OUT, ROOT)}/")


def rank_codes(code):
    return US_STATES if code in US_STATES else CA_PROVINCES


if __name__ == "__main__":
    main()
