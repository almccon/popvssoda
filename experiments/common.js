// Shared helpers for the experimental Pop vs Soda views.
// Expects D3 v7 and topojson-client v3 to be loaded first.

window.PVS = (function () {
	"use strict";

	const TERMS = ["pop", "soda", "coke", "other"];
	const LABEL = { pop: "Pop", soda: "Soda", coke: "Coke", other: "Other" };
	const COUNT_FIELD = { pop: "SUMPOP", soda: "SUMSODA", coke: "SUMCOKE", other: "SUMOTHER" };

	// Darker relatives of the main map's yellow / cyan / magenta, so small
	// marks stay visible on white. "Other" is a deliberately neutral gray,
	// matching the main map, where "other" darkens a county towards black.
	const COLOR = { pop: "#c49a00", soda: "#0a8fbf", coke: "#d13a8a", other: "#555555" };

	const STATE_ABBR = {
		"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
		"10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
		"18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
		"25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
		"32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
		"39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
		"47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
		"55": "WI", "56": "WY",
	};

	const fmt = d3.format(",");
	const pct = (v) => Math.round(v * 100) + "%";

	// Load boundaries and county data. Each county record:
	// { id, name, state (2-digit FIPS), stateName, counts: {pop,...}, total }
	function loadData(base) {
		return Promise.all([
			d3.json(base + "d3/us.json"),
			d3.tsv(base + "d3/pvscounty_fips.tsv"),
		]).then(([us, rows]) => {
			const counties = rows.map((r) => {
				const counts = {};
				for (const t of TERMS) counts[t] = +r[COUNT_FIELD[t]] || 0;
				return {
					id: +r.id,
					name: `${r.County_Name} ${r.ENGTYPE}, ${r.State}`,
					state: r.FIPS_State,
					stateName: r.State,
					counts,
					total: d3.sum(TERMS, (t) => counts[t]),
				};
			});
			return {
				us,
				counties,
				land: topojson.feature(us, us.objects.land),
				countyFeatures: topojson.feature(us, us.objects.counties).features,
				stateFeatures: topojson.feature(us, us.objects.states).features,
				stateMesh: topojson.mesh(us, us.objects.states, (a, b) => a !== b),
			};
		});
	}

	function breakdownHTML(title, counts, total, highlight) {
		const rows = TERMS.map((t) =>
			`<tr${t === highlight ? ' class="hl"' : ""}>` +
			`<td><span class="dot" style="background:${COLOR[t]}"></span>${LABEL[t]}</td>` +
			`<td class="num">${fmt(counts[t])}</td>` +
			`<td class="num">${total ? pct(counts[t] / total) : "–"}</td></tr>`
		).join("");
		return `<strong>${title}</strong>` +
			`<div class="n">${fmt(total)} response${total === 1 ? "" : "s"}</div>` +
			`<table>${rows}</table>`;
	}

	// Tooltip positioned inside `container` next to the pointer.
	function makeTooltip(container) {
		const el = document.createElement("div");
		el.className = "tooltip";
		el.hidden = true;
		container.appendChild(el);
		return {
			show(event, html) {
				el.innerHTML = html;
				el.hidden = false;
				const box = container.getBoundingClientRect();
				const tip = el.getBoundingClientRect();
				let x = event.clientX - box.left + 14;
				let y = event.clientY - box.top + 14;
				if (x + tip.width > box.width) x = event.clientX - box.left - tip.width - 14;
				if (y + tip.height > box.height) y = event.clientY - box.top - tip.height - 14;
				el.style.left = Math.max(0, x) + "px";
				el.style.top = Math.max(0, y) + "px";
			},
			hide() { el.hidden = true; },
		};
	}

	// Color key: one swatch + name per term.
	function colorKeyHTML(shape) {
		return TERMS.map((t) =>
			`<span class="key-item"><span class="${shape}" style="background:${COLOR[t]}"></span>${LABEL[t]}</span>`
		).join("");
	}

	return { TERMS, LABEL, COLOR, STATE_ABBR, fmt, pct, loadData, breakdownHTML, makeTooltip, colorKeyHTML };
})();
