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

	// Projection for the maps that show the US and Canada together: a conic
	// conformal framed on the contiguous US, southern Canada and Alaska, with
	// Hawaii moved into the empty Pacific southwest of California. Hawaii keeps
	// the same scale as the mainland; it's only shifted. Like d3.geoAlbersUsa,
	// it's a composite: points and inverses go to whichever part they belong
	// to, and paths are drawn through both, each part clipped to its own area.
	//
	// Returns the projection plus `inInsetPx(x, y)` and `inInsetLonLat(lon, lat)`,
	// which say whether a pixel or a location belongs to the Hawaii inset.
	function northAmericaProjection(width, height) {
		const main = d3.geoConicConformal()
			.rotate([100, 0]).parallels([30, 60])
			.fitExtent([[8, 8], [width - 8, height - 8]], {
				type: "MultiPoint",
				coordinates: [[-162, 58], [-156.8, 71.3], [-52.6, 47.5], [-80.5, 24.5], [-97.2, 25.8],
					[-117, 32.5], [-124.7, 48.4], [-95, 62]],
			});

		const HAWAII = [[-161, 18.5], [-154.5, 22.5]]; // lon/lat box around the islands
		const HAWAII_CENTER = [-157.3, 20.4];
		const HAWAII_AT = [-127, 27.5]; // where its center goes on the main map
		const hawaii = d3.geoConicConformal()
			.rotate([157, 0]).parallels([30, 60]).scale(main.scale()).translate(main.translate());
		const [hx, hy] = hawaii(HAWAII_CENTER);
		const [tx, ty] = main(HAWAII_AT);
		const [ox, oy] = hawaii.translate();
		hawaii.translate([ox + tx - hx, oy + ty - hy]);
		// Pixel box for the inset: the islands' extent plus a margin.
		const corners = [HAWAII[0], HAWAII[1], [HAWAII[0][0], HAWAII[1][1]], [HAWAII[1][0], HAWAII[0][1]]].map(hawaii);
		const pad = 12;
		const box = [
			[d3.min(corners, (c) => c[0]) - pad, d3.min(corners, (c) => c[1]) - pad],
			[d3.max(corners, (c) => c[0]) + pad, d3.max(corners, (c) => c[1]) + pad],
		];
		hawaii.clipExtent(box);

		const inInsetLonLat = (lon, lat) =>
			lon >= HAWAII[0][0] && lon <= HAWAII[1][0] && lat >= HAWAII[0][1] && lat <= HAWAII[1][1];
		const inInsetPx = (x, y) => x >= box[0][0] && x <= box[1][0] && y >= box[0][1] && y <= box[1][1];

		const projection = ([lon, lat]) => (inInsetLonLat(lon, lat) ? hawaii : main)([lon, lat]);
		projection.invert = ([x, y]) => (inInsetPx(x, y) ? hawaii : main).invert([x, y]);
		projection.stream = (out) => {
			// The real Hawaii lies off the main frame, so the main part only
			// needs clipping to the canvas.
			const streams = [main.stream(out), hawaii.stream(out)];
			const each = (fn) => (...args) => streams.forEach((st) => st[fn](...args));
			return {
				point: each("point"), sphere: each("sphere"), lineStart: each("lineStart"),
				lineEnd: each("lineEnd"), polygonStart: each("polygonStart"), polygonEnd: each("polygonEnd"),
			};
		};
		projection.insetBox = box;
		return { projection, inInsetPx, inInsetLonLat };
	}

	// Color key: one swatch + name per term.
	function colorKeyHTML(shape) {
		return TERMS.map((t) =>
			`<span class="key-item"><span class="${shape}" style="background:${COLOR[t]}"></span>${LABEL[t]}</span>`
		).join("");
	}

	return { TERMS, LABEL, COLOR, STATE_ABBR, fmt, pct, loadData, breakdownHTML, makeTooltip, colorKeyHTML, northAmericaProjection };
})();
