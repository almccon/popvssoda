// State donut cartogram (Dorling-style): one donut per state, area
// proportional to the number of responses, slices for each term.

(function () {
	"use strict";

	const { TERMS, COLOR, STATE_ABBR, fmt, loadData, breakdownHTML, makeTooltip, colorKeyHTML } = PVS;
	const WIDTH = 960, HEIGHT = 600;
	const MAX_RADIUS = 52;      // radius of the state with the most responses
	const HOLE = 0.5;           // inner radius as a fraction of outer radius
	const GAP = 1.5;            // minimum space between donuts, px

	const svg = d3.select("#svg");
	const tooltip = makeTooltip(document.getElementById("chart"));
	document.getElementById("color-key").innerHTML = colorKeyHTML("wedge");

	loadData("../").then((data) => {
		const projection = d3.geoAlbersUsa().fitExtent([[10, 10], [WIDTH - 10, HEIGHT - 10]], data.land);
		const path = d3.geoPath(projection);

		// Sum county counts into states.
		const states = d3.rollups(
			data.counties,
			(cs) => {
				const counts = {};
				for (const t of TERMS) counts[t] = d3.sum(cs, (c) => c.counts[t]);
				return { counts, total: d3.sum(TERMS, (t) => counts[t]), name: cs[0].stateName };
			},
			(c) => c.state
		).map(([fips, s]) => ({ fips, abbr: STATE_ABBR[fips], ...s }));

		const featureById = new Map(data.stateFeatures.map((f) => [+f.id, f]));
		for (const s of states) {
			const f = featureById.get(+s.fips);
			[s.homeX, s.homeY] = f ? path.centroid(f) : [NaN, NaN];
		}
		const nodes = states.filter((s) => s.total > 0 && isFinite(s.homeX));

		const radius = d3.scaleSqrt()
			.domain([0, d3.max(nodes, (s) => s.total)])
			.range([0, MAX_RADIUS]);
		for (const s of nodes) {
			s.r = radius(s.total);
			s.x = s.homeX;
			s.y = s.homeY;
		}

		// Push donuts apart while pulling each towards its state's centroid.
		d3.forceSimulation(nodes)
			.force("x", d3.forceX((d) => d.homeX).strength(0.15))
			.force("y", d3.forceY((d) => d.homeY).strength(0.15))
			.force("collide", d3.forceCollide((d) => d.r + GAP).iterations(4))
			.stop()
			.tick(400);

		// Faint basemap for orientation.
		const base = svg.append("g").attr("class", "basemap");
		base.append("path").attr("class", "land").attr("d", path(data.land));
		base.append("path").attr("class", "states").attr("d", path(data.stateMesh));

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
			.attr("fill", (p) => COLOR[p.data.term]);

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
				tooltip.show(event, breakdownHTML(d.name, d.counts, d.total));
			})
			.on("pointerleave", (event) => {
				if (event.pointerType === "mouse") {
					donuts.attr("opacity", 1);
					tooltip.hide();
				}
			});
		document.addEventListener("pointerdown", (event) => {
			if (!event.target.closest("#svg g g")) {
				donuts.attr("opacity", 1);
				tooltip.hide();
			}
		});

		// Size key.
		const sizes = [1000, 5000, 20000].filter((v) => v <= radius.domain()[1]);
		const big = radius(sizes[sizes.length - 1]);
		const keySvg = d3.select("#size-key").append("svg")
			.attr("width", big * 2 + 70)
			.attr("height", big * 2 + 4);
		const k = keySvg.append("g").attr("transform", `translate(${big + 2},${big * 2 + 2})`);
		for (const v of sizes) {
			const r = radius(v);
			k.append("circle").attr("cy", -r).attr("r", r);
			k.append("line")
				.attr("x1", 0).attr("x2", big + 8)
				.attr("y1", -2 * r).attr("y2", -2 * r)
				.attr("stroke", "#bbb").attr("stroke-dasharray", "2,2");
			k.append("text").attr("x", big + 10).attr("y", -2 * r).attr("dy", "0.35em").text(fmt(v));
		}
		d3.select("#size-key").append("span").text("responses");
	});
})();
