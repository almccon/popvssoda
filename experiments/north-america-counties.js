// US counties and Canadian census divisions on one map, each colored by the
// main map's CMY mix of its responses. Census divisions are Canada's closest
// equivalent to counties. US counts come from data/county_counts.csv and
// Canadian counts from data/census_division_counts.csv (FSAs assigned to the
// division holding most of their land; see data/README.md).

(function () {
	"use strict";

	const { TERMS, countyRecords, fmt, breakdownHTML, makeTooltip, northAmericaProjection, mixCounts, mixKeyHTML } = PVS;
	const WIDTH = 960, HEIGHT = 680;
	const NO_DATA = "#fff";

	const svg = d3.select("#svg");
	const tooltip = makeTooltip(document.getElementById("chart"));
	const statusEl = document.getElementById("status");
	const minInput = document.getElementById("min");
	const minValue = document.getElementById("min-value");
	document.getElementById("color-key").innerHTML = mixKeyHTML() +
		`<span class="key-item"><span class="disc" style="background:${NO_DATA};box-shadow:inset 0 0 0 1px rgba(0,0,0,0.3)"></span>No data (or too few responses)</span>`;
	const regionInputs = document.querySelectorAll("input[name=region]");
	const region = () => [...regionInputs].find((el) => el.checked).value;

	Promise.all([
		d3.json("../d3/us.json"),
		d3.json("../d3/canada.json"),
		d3.csv("../data/county_counts.csv"),
		d3.csv("../data/census_division_counts.csv"),
		d3.json("../vendor/naturalearth-5.1.2-lakes-50m-north-america.geojson"),
	]).then(([us, canada, countyRows, cdRows, lakes]) => {
		const record = (r, name) => {
			const counts = {};
			for (const t of TERMS) counts[t] = +r[t] || 0;
			return { name, counts, total: +r.total || 0 };
		};
		const countyData = countyRecords(countyRows);
		const cdData = new Map(cdRows.map((r) =>
			[r.cduid, record(r, `${r.cd_name}${r.cd_type && r.cd_type !== "Census division" ? ` (${r.cd_type})` : ""}, ${r.province}`)]));

		const usFeatures = topojson.feature(us, us.objects.counties).features.map((f) => ({
			feature: f, country: "US",
			...(countyData.get(+f.id) || { name: "Unknown county", counts: null, total: 0 }),
		}));
		const caFeatures = topojson.feature(canada, canada.objects.census_divisions).features.map((f) => ({
			feature: f, country: "CA",
			...(cdData.get(String(f.id)) || { name: `${f.properties.name}, ${f.properties.province}`, counts: null, total: 0 }),
		}));
		const units = usFeatures.concat(caFeatures);

		const outlines = {
			US: {
				land: topojson.feature(us, us.objects.land),
				inner: topojson.mesh(us, us.objects.states, (a, b) => a !== b),
			},
			CA: {
				land: topojson.merge(canada, canada.objects.provinces.geometries),
				inner: topojson.mesh(canada, canada.objects.provinces, (a, b) => a !== b),
			},
		};

		function projectionFor(which) {
			const pad = [[10, 10], [WIDTH - 10, HEIGHT - 10]];
			if (which === "US") return d3.geoAlbersUsa().fitExtent(pad, outlines.US.land);
			if (which === "CA") return d3.geoConicConformal().rotate([96, 0]).parallels([49, 77]).fitExtent(pad, outlines.CA.land);
			return northAmericaProjection(WIDTH, HEIGHT).projection;
		}

		const landLayer = svg.append("g").attr("class", "basemap");
		const unitLayer = svg.append("g").attr("class", "na-units");
		const lakeLayer = svg.append("g").attr("class", "basemap");
		const lineLayer = svg.append("g").attr("class", "na-lines");
		const hoverPath = svg.append("path").attr("class", "na-hover");
		let unitPaths = null;
		let path = null;

		function render() {
			const which = region();
			const countries = which === "both" ? ["US", "CA"] : [which];
			path = d3.geoPath(projectionFor(which));
			const shown = units.filter((u) => countries.includes(u.country));

			landLayer.selectAll("*").remove();
			lakeLayer.selectAll("*").remove();
			lineLayer.selectAll("*").remove();
			hoverPath.attr("d", null);
			tooltip.hide();

			for (const c of countries) landLayer.append("path").attr("class", "land").attr("d", path(outlines[c].land));
			unitPaths = unitLayer.selectAll("path")
				.data(shown, (u) => `${u.country}-${u.feature.id}`)
				.join("path")
				.attr("d", (u) => path(u.feature));
			lakeLayer.append("path").attr("class", "lake").attr("d", path(lakes));
			for (const c of countries) {
				lineLayer.append("path").attr("class", "inner").attr("d", path(outlines[c].inner));
				lineLayer.append("path").attr("class", "outer").attr("d", path(outlines[c].land));
			}
			recolor();
		}

		function recolor() {
			const min = +minInput.value;
			minValue.textContent = min === 1 ? "1 (show every county)" : `${min} or more`;
			unitPaths.attr("fill", (u) => (u.counts && u.total >= min ? mixCounts(u.counts, u.total) : NO_DATA));

			const shown = unitPaths.data();
			const filled = shown.filter((u) => u.counts && u.total >= min);
			const parts = ["US", "CA"].map((c) => {
				const all = shown.filter((u) => u.country === c);
				if (!all.length) return null;
				const n = filled.filter((u) => u.country === c).length;
				return `${fmt(n)} of ${fmt(all.length)} ${c === "US" ? "US counties" : "census divisions"}`;
			}).filter(Boolean);
			statusEl.textContent = `${fmt(d3.sum(filled, (u) => u.total))} responses. Colored: ` +
				parts.join(" and ") + ". Hover over (or tap) a county or division for its numbers.";
		}

		unitLayer
			.on("pointermove pointerdown", (event) => {
				const u = d3.select(event.target).datum();
				if (!u) return;
				hoverPath.attr("d", path(u.feature));
				tooltip.show(event, u.counts && u.total
					? breakdownHTML(u.name, u.counts, u.total)
					: `<strong>${u.name}</strong><div class="n">No responses</div>`);
			})
			.on("pointerleave", (event) => {
				if (event.pointerType === "mouse") {
					hoverPath.attr("d", null);
					tooltip.hide();
				}
			});
		document.addEventListener("pointerdown", (event) => {
			if (!unitLayer.node().contains(event.target)) {
				hoverPath.attr("d", null);
				tooltip.hide();
			}
		});
		regionInputs.forEach((el) => el.addEventListener("change", render));
		minInput.addEventListener("input", recolor);

		render();
	}).catch((err) => {
		statusEl.textContent = "Couldn't load data: " + err.message;
		throw err;
	});
})();
