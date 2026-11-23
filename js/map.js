// Pop vs Soda county map.
// Uses D3 v7 and topojson-client v3 (vendored in vendor/).

(function () {
	"use strict";

	const WIDTH = 800;
	const HEIGHT = 500;
	const TERMS = ["pop", "soda", "coke", "other"];
	const LABEL = { pop: "Pop", soda: "Soda", coke: "Coke", other: "Other" };
	const NO_DATA_FILL = "white";

	const STATE_NAME = {
		"01": "Alabama", "02": "Alaska", "04": "Arizona", "05": "Arkansas", "06": "California",
		"08": "Colorado", "09": "Connecticut", "10": "Delaware", "11": "District of Columbia",
		"12": "Florida", "13": "Georgia", "15": "Hawaii", "16": "Idaho", "17": "Illinois",
		"18": "Indiana", "19": "Iowa", "20": "Kansas", "21": "Kentucky", "22": "Louisiana",
		"23": "Maine", "24": "Maryland", "25": "Massachusetts", "26": "Michigan", "27": "Minnesota",
		"28": "Mississippi", "29": "Missouri", "30": "Montana", "31": "Nebraska", "32": "Nevada",
		"33": "New Hampshire", "34": "New Jersey", "35": "New Mexico", "36": "New York",
		"37": "North Carolina", "38": "North Dakota", "39": "Ohio", "40": "Oklahoma", "41": "Oregon",
		"42": "Pennsylvania", "44": "Rhode Island", "45": "South Carolina", "46": "South Dakota",
		"47": "Tennessee", "48": "Texas", "49": "Utah", "50": "Vermont", "51": "Virginia",
		"53": "Washington", "54": "West Virginia", "55": "Wisconsin", "56": "Wyoming",
	};

	// The county shapes in d3/us.json predate some changes to county codes.
	// Responses with a newer code are counted in the older county covering it.
	// (experiments/common.js has the same table.)
	const OLD_FIPS = {
		2063: 2261, 2066: 2261,   // Chugach, Copper River → Valdez-Cordova
		2105: 2232, 2230: 2232,   // Hoonah-Angoon, Skagway → Skagway-Hoonah-Angoon
		2158: 2270,               // Kusilvak → Wade Hampton
		2195: 2280, 2275: 2280,   // Petersburg, Wrangell → Wrangell-Petersburg
		2198: 2201,               // Prince of Wales-Hyder → Prince of Wales-Outer Ketchikan
		46102: 46113,             // Oglala Lakota → Shannon
	};

	// ---- Color schemes ------------------------------------------------------

	// Each palette has a "mix" function for the all-terms view (or null if the
	// palette has no such view), and a single-hue ramp for each term.
	//
	// In the mixed views the three main terms are additive (RGB) or subtractive
	// (CMY) primaries, and "other" darkens the color: a county where everyone
	// said "other" is black.
	const ramp = (color) => d3.scaleLinear().domain([0, 1]).range(["white", color]);
	const grayRamp = ramp("black");

	const pct = (v) => Math.round(v * 100) + "%";

	const PALETTES = {
		cmy: {
			mix: (p) => `rgb(${pct(p.pop + p.coke)},${pct(p.soda + p.pop)},${pct(p.coke + p.soda)})`,
			ramps: { pop: ramp("yellow"), soda: ramp("cyan"), coke: ramp("magenta"), other: grayRamp },
			keyNames: { pop: "Yellow", soda: "Cyan", coke: "Magenta" },
			keyColors: { pop: "#ff0", soda: "#0ff", coke: "#f0f" },
		},
		rgb: {
			mix: (p) => `rgb(${pct(p.coke)},${pct(p.pop)},${pct(p.soda)})`,
			// #00ff00 is "lime" in CSS; "green" is #008000.
			ramps: { pop: ramp("lime"), soda: ramp("blue"), coke: ramp("red"), other: grayRamp },
			keyNames: { pop: "Green", soda: "Blue", coke: "Red" },
			keyColors: { pop: "#0f0", soda: "#00f", coke: "#f00" },
		},
		bw: {
			mix: null,
			ramps: { pop: grayRamp, soda: grayRamp, coke: grayRamp, other: grayRamp },
		},
	};

	// Fill for one record ({pop, soda, coke, other} shares, plus noData flag).
	function fillFor(p, state) {
		if (p.noData) return NO_DATA_FILL;
		const palette = PALETTES[state.palette];
		if (state.view === "all") return palette.mix(p);
		return palette.ramps[state.view](p[state.view]);
	}

	// ---- Page state ---------------------------------------------------------

	const state = { view: "all", palette: "cmy" };

	const svg = d3.select("#d3map");
	const tooltip = d3.select("#tooltip");
	const container = document.getElementById("map-container");

	const projection = d3.geoAlbersUsa().scale(856).translate([WIDTH / 2, HEIGHT / 2]);
	const path = d3.geoPath(projection);

	// Layers, bottom to top.
	const landLayer = svg.append("g");
	const countyLayer = svg.append("g").attr("class", "counties");
	const stateLayer = svg.append("g");
	const hoverPath = svg.append("path").attr("class", "hover");
	const legend = buildLegend(svg);

	svg.append("g")
		.attr("class", "author")
		.append("text")
		.attr("x", 550)
		.attr("y", 495)
		.text("CC-BY: Alan McConchie, PopVsSoda.com");

	let counties = null; // d3 selection, set once data loads

	// ---- Legend -------------------------------------------------------------

	function buildLegend(svg) {
		const g = svg.append("g").attr("class", "legend");

		// Ternary (triangle) legend: soda at the top, pop bottom-left,
		// coke bottom-right. Split into DIVISIONS^2 small triangles, each
		// colored by the mix at its centroid.
		const DIVISIONS = 10;
		const side = 64;
		const top = [690, 398];
		const height = (side * Math.sqrt(3)) / 2;
		const corners = {
			soda: top,
			pop: [top[0] - side / 2, top[1] + height],
			coke: [top[0] + side / 2, top[1] + height],
		};

		// Grid point i rows down from the top, j steps towards coke.
		const shares = (i, j) => ({
			soda: (DIVISIONS - i) / DIVISIONS,
			pop: (i - j) / DIVISIONS,
			coke: j / DIVISIONS,
		});
		const toXY = (s) => [
			s.soda * corners.soda[0] + s.pop * corners.pop[0] + s.coke * corners.coke[0],
			s.soda * corners.soda[1] + s.pop * corners.pop[1] + s.coke * corners.coke[1],
		];
		const cells = [];
		const addCell = (pts) => {
			const c = { pop: 0, soda: 0, coke: 0, other: 0 };
			pts.forEach((s) => { c.pop += s.pop / 3; c.soda += s.soda / 3; c.coke += s.coke / 3; });
			cells.push({ shares: c, d: "M" + pts.map(toXY).join("L") + "Z" });
		};
		for (let i = 0; i < DIVISIONS; i++) {
			for (let j = 0; j <= i; j++) {
				addCell([shares(i, j), shares(i + 1, j), shares(i + 1, j + 1)]); // pointing up
				if (j < i) addCell([shares(i, j), shares(i, j + 1), shares(i + 1, j + 1)]); // pointing down
			}
		}

		const tri = g.append("g");
		tri.append("path")
			.attr("class", "landshadow")
			.attr("d", "M" + [corners.soda, corners.pop, corners.coke].join("L") + "Z");
		const triCells = tri.selectAll(".swatch")
			.data(cells)
			.join("path")
			.attr("class", "swatch")
			.attr("d", (d) => d.d);
		tri.selectAll("text")
			.data([
				{ label: "soda", x: corners.soda[0], y: corners.soda[1] - 6 },
				{ label: "pop", x: corners.pop[0] - 4, y: corners.pop[1] + 13 },
				{ label: "coke", x: corners.coke[0] + 4, y: corners.coke[1] + 13 },
			])
			.join("text")
			.attr("text-anchor", "middle")
			.attr("x", (d) => d.x)
			.attr("y", (d) => d.y)
			.text((d) => d.label);

		// Linear legend: a ramp of swatches from 0% to 100% of one term.
		const STEPS = 20;
		const rampX = 545, rampY = 446, rampW = 70, rampH = 10;
		const lin = g.append("g");
		lin.append("rect")
			.attr("class", "landshadow")
			.attr("x", rampX).attr("y", rampY).attr("width", rampW).attr("height", rampH);
		const linCells = lin.selectAll(".swatch")
			.data(d3.range(STEPS + 1).map((i) => i / STEPS))
			.join("rect")
			.attr("class", "swatch")
			.attr("x", (d, i) => rampX + (i * rampW) / (STEPS + 1))
			.attr("y", rampY)
			.attr("width", rampW / (STEPS + 1) + 0.5) // overlap slightly to avoid seams
			.attr("height", rampH);
		lin.append("text").attr("x", rampX).attr("y", rampY + 21).attr("text-anchor", "start").text("0%");
		lin.append("text").attr("x", rampX + rampW).attr("y", rampY + 21).attr("text-anchor", "end").text("100%");
		const linLabel = lin.append("text")
			.attr("x", rampX + rampW / 2)
			.attr("y", rampY - 5)
			.attr("text-anchor", "middle");

		// "No data" swatch.
		const noData = g.append("g");
		noData.append("rect")
			.attr("class", "landshadow")
			.attr("x", 480).attr("y", rampY).attr("width", 26).attr("height", rampH);
		noData.append("rect")
			.attr("x", 480).attr("y", rampY).attr("width", 26).attr("height", rampH)
			.attr("fill", NO_DATA_FILL);
		noData.append("text").attr("x", 493).attr("y", rampY + 21).attr("text-anchor", "middle").text("no data");

		return {
			update(state) {
				const palette = PALETTES[state.palette];
				const showMix = state.view === "all";
				const rampTerm = showMix ? "other" : state.view;
				const t = svg.transition().duration(400);

				triCells.attr("fill", (d) => (palette.mix ? palette.mix(d.shares) : NO_DATA_FILL));
				tri.transition(t).attr("opacity", showMix ? 1 : 0);

				linCells.attr("fill", (d) => palette.ramps[rampTerm](d));
				linLabel.text(rampTerm);
			},
		};
	}

	// ---- Tooltip ------------------------------------------------------------

	const fmt = d3.format(",");

	function tooltipHTML(d) {
		const p = d.properties;
		if (!p.name) return "<strong>No data</strong>";
		const title = `<strong>${p.name}</strong>`;
		if (p.noData) return title + "No responses";
		const rows = TERMS.map((t) =>
			`<tr><td>${LABEL[t]}</td><td class="num">${fmt(p.counts[t])}</td>` +
			`<td class="num">${pct(p[t])}</td></tr>`
		).join("");
		return `${title}<div class="n">${fmt(p.total)} response${p.total === 1 ? "" : "s"}</div>` +
			`<table>${rows}</table>`;
	}

	function showTooltip(event, d) {
		hoverPath.attr("d", path(d));
		tooltip.html(tooltipHTML(d)).attr("hidden", null);

		// Position next to the pointer, flipping to stay inside the map.
		const box = container.getBoundingClientRect();
		const tip = tooltip.node().getBoundingClientRect();
		let x = event.clientX - box.left + 14;
		let y = event.clientY - box.top + 14;
		if (x + tip.width > box.width) x = event.clientX - box.left - tip.width - 14;
		if (y + tip.height > box.height) y = event.clientY - box.top - tip.height - 14;
		tooltip.style("left", Math.max(0, x) + "px").style("top", Math.max(0, y) + "px");
	}

	function hideTooltip() {
		hoverPath.attr("d", null);
		tooltip.attr("hidden", true);
	}

	// ---- Controls -----------------------------------------------------------

	const viewButtons = d3.selectAll("[data-view]");
	const paletteButtons = d3.selectAll("[data-palette]");

	function render() {
		viewButtons.attr("aria-pressed", function () { return String(this.dataset.view === state.view); });
		paletteButtons.attr("aria-pressed", function () { return String(this.dataset.palette === state.palette); });

		// Black and white has no all-terms view.
		const noMix = !PALETTES[state.palette].mix;
		viewButtons.filter("[data-view=all]")
			.property("disabled", noMix)
			.attr("title", noMix ? "Not available in black and white" : null);

		// Update the color names in the "Reading the map" key.
		const palette = PALETTES[state.palette.replace("bw", "cmy")];
		d3.selectAll("#color-key li").each(function () {
			const key = this.querySelector("[data-key]").dataset.key;
			this.querySelector("[data-key]").textContent = palette.keyNames[key];
			this.querySelector(".swatch").style.background = palette.keyColors[key];
		});

		legend.update(state);
		if (counties) counties.attr("fill", (d) => fillFor(d.properties, state));
	}

	viewButtons.on("click", function () {
		state.view = this.dataset.view;
		render();
	});

	paletteButtons.on("click", function () {
		state.palette = this.dataset.palette;
		if (state.palette === "bw" && state.view === "all") state.view = "pop";
		render();
	});

	render(); // draw the legend before the data arrives

	// ---- Data ---------------------------------------------------------------

	Promise.all([
		d3.json("d3/us.json"),
		d3.csv("data/county_counts.csv"),
	]).then(([us, rows]) => {
		// Sum counts per county shape, then turn them into shares.
		const byId = new Map();
		for (const r of rows) {
			const id = OLD_FIPS[+r.county_fips] || +r.county_fips;
			const name = `${r.county_name}, ${STATE_NAME[r.county_fips.slice(0, 2)] || ""}`;
			let rec = byId.get(id);
			if (rec) rec.name = rec.name.replace(/, ([^,]+)$/, ` and ${name}`);
			else byId.set(id, rec = { name, counts: { pop: 0, soda: 0, coke: 0, other: 0 }, total: 0 });
			for (const t of TERMS) rec.counts[t] += +r[t] || 0;
			rec.total += +r.total || 0;
		}
		for (const rec of byId.values()) {
			for (const t of TERMS) rec[t] = rec.total ? rec.counts[t] / rec.total : 0;
			rec.noData = !rec.total;
		}

		const features = topojson.feature(us, us.objects.counties).features;
		for (const f of features) {
			// Counties with no responses are drawn as no data.
			f.properties = byId.get(+f.id) || { noData: true };
		}

		landLayer.append("path")
			.datum(topojson.feature(us, us.objects.land))
			.attr("class", "landshadow")
			.attr("d", path);

		counties = countyLayer.selectAll("path")
			.data(features)
			.join("path")
			.attr("d", path);

		stateLayer.append("path")
			.datum(topojson.mesh(us, us.objects.states, (a, b) => a !== b))
			.attr("class", "states")
			.attr("d", path);

		countyLayer
			.on("pointermove pointerdown", (event) => {
				const d = d3.select(event.target).datum();
				if (d) showTooltip(event, d);
			})
			.on("pointerleave", (event) => {
				// For touch, leave fires right after the tap; keep the tooltip.
				if (event.pointerType === "mouse") hideTooltip();
			});

		// A tap anywhere outside the counties hides the tooltip.
		document.addEventListener("pointerdown", (event) => {
			if (!countyLayer.node().contains(event.target)) hideTooltip();
		});

		document.getElementById("map-status").remove();
		render();
	}).catch((error) => {
		console.error(error);
		document.getElementById("map-status").textContent = "Sorry, the map data could not be loaded.";
	});
})();
