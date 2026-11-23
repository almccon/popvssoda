// State and province donut cartogram (Dorling-style): one donut per state,
// province or territory, area proportional to the number of responses (or to
// its 2010 population), slices for each term. Counts come from data/state_counts.csv, which includes every
// response that named a state or province, with or without a usable ZIP code.
// Each donut starts at the center of its state's responses.

(function () {
	"use strict";

	const { TERMS, COLOR, TERM_FILL, STATE_ABBR, fmt, breakdownHTML, makeTooltip, colorKeyHTML, regionProjection } = PVS;
	const { width: WIDTH, height: HEIGHT } = PVS.FRAME;
	const MAX_RADIUS = 52;      // radius of the place with the most responses
	const HOLE = 0.5;           // inner radius as a fraction of outer radius
	const GAP = 1.5;            // minimum space between donuts, px

	const svg = d3.select("#svg");
	const tooltip = makeTooltip(document.getElementById("chart"));
	const statusEl = document.getElementById("status");
	document.getElementById("color-key").innerHTML = colorKeyHTML("wedge");
	const regionInputs = document.querySelectorAll("input[name=region]");
	const region = () => [...regionInputs].find((el) => el.checked).value;
	const sizeInputs = document.querySelectorAll("input[name=size-by]");
	const byPopulation = () => [...sizeInputs].find((el) => el.checked).value === "population";
	// Census division codes start with the province's 2-digit code.
	const PROVINCE = { 10: "NL", 11: "PE", 12: "NS", 13: "NB", 24: "QC", 35: "ON", 46: "MB", 47: "SK", 48: "AB", 59: "BC", 60: "YT", 61: "NT", 62: "NU" };

	Promise.all([
		d3.json("../vendor/world-atlas-2.0.2-countries-50m.json"),
		d3.json("../vendor/naturalearth-5.1.2-admin1-50m-us-canada.geojson"),
		d3.json("../vendor/naturalearth-5.1.2-lakes-50m-north-america.geojson"),
		d3.csv("../data/state_counts.csv"),
		d3.csv("../data/postal_counts.csv"),
		d3.csv("../data/county_population_2010.csv"),
		d3.csv("../data/census_division_population_2010.csv"),
	]).then(([world, admin1, lakes, rows, postal, countyPop, cdPop]) => {
		// 2010 populations: the US census by county and Statistics Canada's
		// estimates by census division, summed by state and province.
		const population = new Map();
		const add = (key, n) => population.set(key, (population.get(key) || 0) + n);
		for (const r of countyPop) add(`US-${STATE_ABBR[r.county_fips.slice(0, 2)]}`, +r.population_2010);
		for (const r of cdPop) add(`CA-${PROVINCE[r.cduid.slice(0, 2)]}`, +r.population_2010);

		const countryLand = (id) => topojson.feature(world,
			{ type: "GeometryCollection", geometries: world.objects.countries.geometries.filter((g) => g.id === id) });
		const land = { US: countryLand("840"), CA: countryLand("124") };
		const featureByCode = new Map(admin1.features.map((f) => [`${f.properties.country}-${f.properties.postal}`, f]));

		// One record per state / province with a shape on the map (so not
		// Puerto Rico, Guam, military addresses and so on).
		const places = [];
		for (const r of rows) {
			const f = featureByCode.get(`${r.country}-${r.state}`);
			if (!f || !+r.total) continue;
			const counts = {};
			for (const t of TERMS) counts[t] = +r[t];
			places.push({
				country: r.country, abbr: r.state, name: f.properties.name, feature: f,
				counts, total: +r.total, population: population.get(`${r.country}-${r.state}`) || 0,
				points: postal.filter((p) => p.country === r.country && p.state === r.state && p.lat && +p.total),
			});
		}

		// Each view is sized to its own biggest donut, so Canada on its own
		// isn't a map of specks. The size key follows.
		const radius = d3.scaleSqrt().range([0, MAX_RADIUS]);

		const projectionFor = regionProjection; // the same for every map; see common.js

		const credit = PVS.addCredit(document.getElementById("chart"));
		function render() {
			const which = region();
			credit.setRegion(which);
			const shown = places.filter((p) => which === "both" || p.country === which);
			const projection = projectionFor(which);
			const path = d3.geoPath(projection);

			const sized = (p) => (byPopulation() ? p.population : p.total);
			radius.domain([0, d3.max(shown, sized)]);
			updateSizeKey();
			for (const p of shown) {
				// Home: the center of the state's responses (each ZIP code or FSA
				// weighted by its responses), which for big northern provinces is
				// far from the middle of their land. Falls back to the centroid.
				let sx = 0, sy = 0, sw = 0;
				for (const q of p.points) {
					const xy = projection([+q.lon, +q.lat]);
					if (!xy) continue;
					sx += xy[0] * q.total; sy += xy[1] * q.total; sw += +q.total;
				}
				[p.homeX, p.homeY] = sw ? [sx / sw, sy / sw] : path.centroid(p.feature);
				p.r = radius(sized(p));
				p.x = p.homeX;
				p.y = p.homeY;
				p.vx = p.vy = 0;
			}
			const nodes = shown.filter((p) => isFinite(p.homeX));

			// Push donuts apart while pulling each towards its centroid.
			d3.forceSimulation(nodes)
				.force("x", d3.forceX((d) => d.homeX).strength(0.15))
				.force("y", d3.forceY((d) => d.homeY).strength(0.15))
				.force("collide", d3.forceCollide((d) => d.r + GAP).iterations(4))
				.stop()
				.tick(400);

			svg.selectAll("*").remove();
			tooltip.hide();

			// Faint basemap for orientation.
			const countries = which === "both" ? ["US", "CA"] : [which];
			const base = svg.append("g").attr("class", "basemap");
			for (const c of countries) base.append("path").attr("class", "land").attr("d", path(land[c]));
			base.append("path").attr("class", "lake").attr("d", path(lakes));
			base.append("path").attr("class", "states").attr("d", path({
				type: "FeatureCollection",
				features: admin1.features.filter((f) => countries.includes(f.properties.country)),
			}));

			// Thin leader lines from centroid to donut, where a donut moved.
			svg.append("g")
				.selectAll("line")
				.data(nodes.filter((d) => Math.hypot(d.x - d.homeX, d.y - d.homeY) > d.r * 0.6))
				.join("line")
				.attr("x1", (d) => d.homeX).attr("y1", (d) => d.homeY)
				.attr("x2", (d) => d.x).attr("y2", (d) => d.y)
				.attr("stroke", "#bbb")
				.attr("stroke-width", 0.75);

			const pie = d3.pie().sort(null).value((t) => t.value);
			const arc = d3.arc();

			const donuts = svg.append("g")
				.attr("class", "donuts")
				.selectAll("g")
				.data(nodes)
				.join("g")
				.attr("transform", (d) => `translate(${d.x},${d.y})`)
				.style("cursor", "default");

			donuts.selectAll("path")
				.data((d) => pie(TERMS.map((t) => ({ term: t, value: d.counts[t] })))
					.map((p) => Object.assign(p, {
						outerRadius: d.r,
						innerRadius: d.r * HOLE,
						// a fixed ~1px gap between slices, whatever the donut size
						padAngle: Math.min(0.04, 1.2 / d.r),
					})))
				.join("path")
				.attr("d", arc)
				// Pure colors like the main map's, outlined in the darker line colors.
				.attr("fill", (p) => TERM_FILL[p.data.term])
				.attr("stroke", (p) => COLOR[p.data.term])
				.attr("stroke-width", 0.75);

			// Transparent disc so the hole is hoverable too.
			donuts.append("circle")
				.attr("r", (d) => d.r)
				.attr("fill", "transparent");

			donuts.filter((d) => d.r >= 15)
				.append("text")
				.attr("text-anchor", "middle")
				.attr("dy", "0.35em")
				.attr("font-size", (d) => Math.min(13, d.r * 0.42))
				.attr("font-weight", "bold")
				.attr("fill", "#333")
				.attr("pointer-events", "none")
				.text((d) => d.abbr);

			donuts
				.on("pointermove pointerdown", (event, d) => {
					donuts.attr("opacity", (o) => (o === d ? 1 : 0.35));
					tooltip.show(event, breakdownHTML(`${d.name} (population ${fmt(d.population)})`, d.counts, d.total));
				})
				.on("pointerleave", (event) => {
					if (event.pointerType === "mouse") {
						donuts.attr("opacity", 1);
						tooltip.hide();
					}
				});

			const n = d3.sum(nodes, (d) => d.total);
			const states = nodes.filter((d) => d.country === "US").length;
			const provs = nodes.filter((d) => d.country === "CA").length;
			statusEl.textContent = `${fmt(n)} responses` +
				(byPopulation() ? `, donuts sized by ${fmt(d3.sum(nodes, (d) => d.population))} people (2010)` : "") + ": " + [
				states && `${states} states (with DC)`,
				provs && `${provs} provinces and territories`,
			].filter(Boolean).join(" and ") + ". Hover over (or tap) a donut for its numbers.";
		}

		document.addEventListener("pointerdown", (event) => {
			if (!event.target.closest(".donuts g")) {
				svg.selectAll(".donuts g").attr("opacity", 1);
				tooltip.hide();
			}
		});
		regionInputs.forEach((el) => el.addEventListener("change", render));
		sizeInputs.forEach((el) => el.addEventListener("change", render));

		function updateSizeKey() {
			const top = radius.domain()[1];
			const sizes = (byPopulation()
				? [100000, 1000000, 5000000, 10000000, 30000000]
				: [100, 500, 1000, 5000, 20000]).filter((v) => v <= top).slice(-3);
			const big = radius(sizes[sizes.length - 1]);
			const key = d3.select("#size-key").html("");
			const k = key.append("svg")
				.attr("width", big * 2 + (byPopulation() ? 90 : 70))
				.attr("height", big * 2 + 4)
				.append("g").attr("transform", `translate(${big + 2},${big * 2 + 2})`);
			for (const v of sizes) {
				const r = radius(v);
				k.append("circle").attr("cy", -r).attr("r", r);
				k.append("line")
					.attr("x1", 0).attr("x2", big + 8)
					.attr("y1", -2 * r).attr("y2", -2 * r)
					.attr("stroke", "#bbb").attr("stroke-dasharray", "2,2");
				k.append("text").attr("x", big + 10).attr("y", -2 * r).attr("dy", "0.35em").text(fmt(v));
			}
			key.append("span").text(byPopulation() ? "people" : "responses");
		}

		render();
	}).catch((err) => {
		statusEl.textContent = "Couldn't load data: " + err.message;
		throw err;
	});
})();
