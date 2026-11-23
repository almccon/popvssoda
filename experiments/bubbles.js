// Bubbles: four circles per county (pop / soda / coke / other), area
// proportional to the number of responses, spread apart with a force layout.
// Or one circle per county, colored with the main map's CMY mix. Canada is
// included as census divisions, its closest equivalent to counties, and the
// map shows the US and Canada together or either alone. Optionally each
// state and province is outlined, its border swelling to hold its bubbles.
// Drawn on canvas: there are ~9,500 circles and they move while settling.
// The circles grow from nothing while the layout runs, starting in the south
// and rising northward like bubbles in a glass.

(function () {
	"use strict";

	const { TERMS, LABEL, COLOR, fmt, loadData, breakdownHTML, makeTooltip, mixCounts, swellingOutlines, separateStates, drawBasemap } = PVS;
	// Pure colors like the main map's, outlined in the darker line colors.
	const FILL = PVS.TERM_FILL;
	const OUTLINE = COLOR;
	const { width: WIDTH, height: HEIGHT } = PVS.FRAME;
	const PADDING = 0.4; // px between touching circles
	const STATE_GAP = 5; // px between circles from different states, with outlines on

	// Each circle grows from zero to full size over GROW_MS. When it starts
	// depends on its county's latitude: the southernmost start at once, the
	// northernmost after STAGGER_MS, when the southern ones are full grown.
	// The stagger spans the lower 48 (Hawaii starts with the far south,
	// Alaska with the far north), so the wave moves steadily up the map.
	const GROW_MS = 5000;
	const STAGGER_MS = 5000;
	// Latitudes the wave runs between, for each region.
	const WAVE_LAT = { US: [25, 49], CA: [42, 62], both: [25, 60] };
	const grow = d3.easeQuadOut;
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	// Each term starts a hair away from the county center in its own
	// direction, so the layout is deterministic and the four circles
	// settle in a consistent arrangement.
	const START_OFFSET = {
		pop: [-0.7, -0.7], soda: [0.7, -0.7], coke: [0.7, 0.7], other: [-0.7, 0.7],
	};

	const canvas = document.getElementById("canvas");
	const ctx = canvas.getContext("2d");
	const statusEl = document.getElementById("status");
	const slider = document.getElementById("size");
	const sliderValue = document.getElementById("size-value");
	const tooltip = makeTooltip(document.getElementById("chart"));
	const BLEND_OUTLINE = "rgba(0,0,0,0.45)";
	const termKeyHTML = TERMS.map((t) =>
		`<span class="key-item"><span class="disc" style="background:${FILL[t]}` +
		`${OUTLINE[t] ? `;box-shadow:inset 0 0 0 1px ${OUTLINE[t]}` : ""}"></span>${LABEL[t]}</span>`
	).join("");

	function sizeCanvas() {
		const dpr = window.devicePixelRatio || 1;
		canvas.width = WIDTH * dpr;
		canvas.height = HEIGHT * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}
	sizeCanvas();

	const sizeInputs = document.querySelectorAll("input[name=size-by]");
	const sizeBy = () => [...sizeInputs].find((el) => el.checked).value;
	const circleInputs = document.querySelectorAll("input[name=circles]");
	const blended = () => [...circleInputs].find((el) => el.checked).value === "blend";
	const outlinesInput = document.getElementById("outlines");
	const regionInputs = document.querySelectorAll("input[name=region]");
	const region = () => [...regionInputs].find((el) => el.checked).value;

	Promise.all([
		loadData("../"),
		d3.json("../d3/canada.json"),
		d3.csv("../data/county_population_2010.csv"),
		d3.csv("../data/census_division_counts.csv"),
		d3.csv("../data/census_division_population_2010.csv"),
		d3.json("../vendor/naturalearth-5.1.2-lakes-50m-north-america.geojson"),
	]).then(([data, canada, popRows, cdRows, cdPopRows, lakes]) => {
		const usPopulation = new Map(popRows.map((r) => [+r.county_fips, +r.population_2010]));
		const cdPopulation = new Map(cdPopRows.map((r) => [r.cduid, +r.population_2010]));

		// Every county and census division with responses:
		// { name, counts, total, population, feature, country, stateKey, lat }
		const units = [];
		const countyFeature = new Map(data.countyFeatures.map((f) => [+f.id, f]));
		for (const c of data.counties) {
			const f = countyFeature.get(c.id);
			if (!f || !c.total) continue;
			Object.assign(c, { population: usPopulation.get(c.id) || 0, feature: f, country: "US", stateKey: `US-${c.state}` });
			units.push(c);
		}
		const cdFeature = new Map(topojson.feature(canada, canada.objects.census_divisions).features.map((f) => [String(f.id), f]));
		for (const r of cdRows) {
			const f = cdFeature.get(r.cduid);
			if (!f || !+r.total) continue;
			const counts = {};
			for (const t of TERMS) counts[t] = +r[t];
			units.push({
				name: `${r.cd_name}, ${r.province}`, counts, total: +r.total,
				population: cdPopulation.get(r.cduid) || 0, feature: f, country: "CA", stateKey: `CA-${r.province}`,
			});
		}
		for (const u of units) u.lat = d3.geoCentroid(u.feature)[1];

		// One node per (unit, term) with at least one response, or (blended) one per unit.
		const allPerAnswer = [], allPerCounty = [];
		for (const u of units) {
			for (const t of TERMS) {
				// `people`: the unit's population split in proportion to its answers.
				if (u.counts[t] > 0) allPerAnswer.push({
					county: u, term: t, n: u.counts[t], stateKey: u.stateKey,
					people: u.population * u.counts[t] / u.total,
					fill: FILL[t], stroke: OUTLINE[t], offset: START_OFFSET[t],
				});
			}
			allPerCounty.push({
				county: u, term: null, n: u.total, stateKey: u.stateKey, people: u.population,
				fill: mixCounts(u.counts, u.total), stroke: BLEND_OUTLINE, offset: [0, 0],
			});
		}

		// In population mode, people are scaled by the ratio of responses to
		// population over everything mapped, so both modes put about the same
		// total area on the map and share the size slider.
		const PEOPLE_PER_RESPONSE = d3.sum(allPerAnswer, (d) => d.people) / d3.sum(allPerAnswer, (d) => d.n);
		const sizeValue = (d) => (sizeBy() === "population" ? d.people / PEOPLE_PER_RESPONSE : d.n);

		// Background layers and outline shapes for each country.
		const geo = {
			US: {
				land: data.land, admin: data.stateMesh,
				states: data.stateFeatures.map((f) => ({ key: `US-${String(f.id).padStart(2, "0")}`, feature: f })),
			},
			CA: {
				land: topojson.merge(canada, canada.objects.provinces.geometries),
				admin: topojson.mesh(canada, canada.objects.provinces, (a, b) => a !== b),
				states: topojson.feature(canada, canada.objects.provinces).features
					.map((f) => ({ key: `CA-${f.properties.province}`, feature: f })),
			},
		};
		// Map scale near the 49th parallel, which every region shows.
		function pxPerKm(proj) {
			const a = proj([-90, 48]), b = proj([-89, 48]);
			return Math.hypot(b[0] - a[0], b[1] - a[1]) / (111.32 * Math.cos((48 * Math.PI) / 180));
		}
		const usPx = pxPerKm(PVS.usProjection());

		// Set for the region shown, by setRegion().
		let projection, landPath, lakePath, adminPath, stateShapes, perAnswer = [], perCounty = [];
		let sizeFactor = 1; // circles follow the map scale: a closer view gets bigger circles
		const credit = PVS.addCredit(document.getElementById("chart"));
		function setRegion() {
			const which = region();
			credit.setRegion(which);
			const countries = which === "both" ? ["US", "CA"] : [which];
			projection = PVS.regionProjection(which);
			const path = d3.geoPath(projection);
			const joined = (layer) => new Path2D(countries.map((c) => path(geo[c][layer]) || "").join(""));
			landPath = joined("land");
			adminPath = joined("admin");
			lakePath = new Path2D(path(lakes));
			stateShapes = countries.flatMap((c) => geo[c].states);
			sizeFactor = Math.sqrt(pxPerKm(projection) / usPx);

			const [south, north] = WAVE_LAT[which];
			for (const u of units) {
				[u.homeX, u.homeY] = countries.includes(u.country) ? path.centroid(u.feature) : [NaN, NaN];
				u.delay = reducedMotion ? 0 : STAGGER_MS * Math.min(1, Math.max(0, (u.lat - south) / (north - south)));
			}
			for (const d of allPerAnswer.concat(allPerCounty)) {
				d.homeX = d.county.homeX;
				d.homeY = d.county.homeY;
				d.delay = d.county.delay;
			}
			const shown = (d) => isFinite(d.homeX) && isFinite(d.homeY);
			perAnswer = allPerAnswer.filter(shown);
			perCounty = allPerCounty.filter(shown);
		}

		let nodes = perAnswer;
		let outlines = null;

		let scale = +slider.value; // px of radius per sqrt(response)
		let hovered = null;        // county record under the pointer

		function draw() {
			ctx.clearRect(0, 0, WIDTH, HEIGHT);
			drawBasemap(ctx, { land: landPath, lakes: lakePath, admin: outlines ? null : adminPath, clipLakes: true });
			// Under the bubbles: each state's outline runs just outside its own
			// bubbles, in the gap kept between states, and any stretch of border
			// that wanders under other bubbles is hidden.
			if (outlines) outlines.draw(ctx);

			ctx.globalAlpha = hovered ? 0.35 : 1;
			ctx.lineWidth = 0.75;
			if (blended()) {
				// Every county has its own color.
				for (const d of nodes) {
					if (d.r <= 0) continue;
					ctx.beginPath();
					ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
					ctx.fillStyle = d.fill;
					ctx.fill();
					if (d.r > 1.5) {
						ctx.strokeStyle = d.stroke;
						ctx.stroke();
					}
				}
			} else {
				// Batch circles by color: far fewer state changes than per-circle.
				for (const t of TERMS) {
					ctx.beginPath();
					for (const d of nodes) {
						if (d.term !== t || d.r <= 0) continue;
						ctx.moveTo(d.x + d.r, d.y);
						ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
					}
					ctx.fillStyle = FILL[t];
					ctx.fill();
					ctx.strokeStyle = OUTLINE[t];
					ctx.stroke();
				}
			}
			ctx.globalAlpha = 1;

			if (hovered) {
				for (const d of nodes) {
					if (d.county !== hovered) continue;
					ctx.beginPath();
					ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
					ctx.fillStyle = d.fill;
					ctx.fill();
					ctx.lineWidth = 1.5;
					ctx.strokeStyle = "#222";
					ctx.stroke();
				}
			}
		}

		// Grow every circle to its size at `elapsed` ms. Returns true once all are full size.
		let startTime = 0;
		function growCircles(elapsed) {
			let done = true;
			for (const d of nodes) {
				const k = Math.min(1, Math.max(0, (elapsed - d.delay) / GROW_MS));
				if (k < 1) done = false;
				d.r = d.fullR * (reducedMotion ? 1 : grow(k));
			}
			simulation.force("collide").radius((d) => d.r + PADDING); // re-read radii
			return done;
		}

		let growing = false;
		const simulation = d3.forceSimulation()
			.force("x", d3.forceX((d) => d.homeX).strength(0.08))
			.force("y", d3.forceY((d) => d.homeY).strength(0.08))
			.force("collide", d3.forceCollide((d) => d.r + PADDING).iterations(2))
			.alphaDecay(0.03)
			.on("tick", () => {
				if (growing) {
					const elapsed = performance.now() - startTime;
					if (growCircles(elapsed)) {
						// Everything is full size: stop holding the layout warm
						// and let it settle.
						growing = false;
						simulation.alphaTarget(0);
					}
					statusEl.textContent = `Bubbling up… ${Math.round(Math.min(1, elapsed / (GROW_MS + STAGGER_MS)) * 100)}%`;
				} else {
					statusEl.textContent = `Settling… ${Math.round((1 - simulation.alpha()) * 100)}%`;
				}
				keepOnCanvas();
				draw();
			})
			.on("end", () => {
				statusEl.textContent = `${fmt(nodes.length)} circles for ${fmt(d3.sum(nodes, (d) => d.n))} responses` +
					(sizeBy() === "population"
						? `, sized by ${fmt(Math.round(d3.sum(nodes, (d) => d.people)))} people (2010). `
						: ". ") +
					"Hover over (or tap) a circle for its county or census division.";
			});

		// Stop bubbles from being pushed off the edge of the map.
		function keepOnCanvas() {
			for (const d of nodes) {
				d.x = Math.max(d.r, Math.min(WIDTH - d.r, d.x));
				d.y = Math.max(d.r, Math.min(HEIGHT - d.r, d.y));
			}
		}

		function start() {
			setRegion();
			nodes = blended() ? perCounty : perAnswer;
			hovered = null;
			document.getElementById("color-key").innerHTML = blended() ? "" : termKeyHTML;
			PVS.showMixKey(document.getElementById("chart"), blended());
			// A blended circle holds a whole county, so at the same slider
			// setting it has the area of that county's four separate circles.
			for (const d of nodes) {
				d.fullR = scale * sizeFactor * Math.sqrt(sizeValue(d));
				const [ox, oy] = d.offset;
				d.x = d.homeX + ox;
				d.y = d.homeY + oy;
				d.vx = d.vy = 0;
			}
			simulation.nodes(nodes);
			outlines = outlinesInput.checked
				? swellingOutlines(stateShapes, projection, nodes, { width: WIDTH, height: HEIGHT, dpr: window.devicePixelRatio || 1 })
				: null;
			simulation.force("states", outlines ? separateStates(STATE_GAP) : null);
			startTime = performance.now();
			growing = !reducedMotion;
			growCircles(reducedMotion ? Infinity : 0);
			// Keep the layout running while the circles grow, so neighbours
			// make room for each other as they swell.
			simulation.alphaTarget(growing ? 0.3 : 0).alpha(1).restart();
			updateSizeKey();
		}

		function updateSizeKey() {
			sliderValue.textContent = scale.toFixed(2);
			const byPeople = sizeBy() === "population";
			const sizes = byPeople ? [100000, 1000000, 5000000] : [100, 1000, 5000];
			const unit = byPeople ? 1 / PEOPLE_PER_RESPONSE : 1;
			const big = scale * sizeFactor * Math.sqrt(sizes[sizes.length - 1] * unit);
			const key = d3.select("#size-key").html("");
			const svg = key.append("svg").attr("width", big * 2 + (byPeople ? 76 : 50)).attr("height", big * 2 + 4);
			const g = svg.append("g").attr("transform", `translate(${big + 2},${big * 2 + 2})`);
			for (const v of sizes) {
				const r = scale * sizeFactor * Math.sqrt(v * unit);
				g.append("circle").attr("cy", -r).attr("r", r);
				g.append("line")
					.attr("x1", 0).attr("x2", big + 6)
					.attr("y1", -2 * r).attr("y2", -2 * r)
					.attr("stroke", "#bbb").attr("stroke-dasharray", "2,2");
				g.append("text").attr("x", big + 8).attr("y", -2 * r).attr("dy", "0.35em").text(fmt(v));
			}
			key.append("span").text(byPeople ? "people" : "responses");
		}

		// ---- Hover ------------------------------------------------------------

		function nodeAt(event) {
			const rect = canvas.getBoundingClientRect();
			const x = ((event.clientX - rect.left) * WIDTH) / rect.width;
			const y = ((event.clientY - rect.top) * HEIGHT) / rect.height;
			// Smallest circle containing the point; a little slack for tiny ones.
			let best = null;
			for (const d of nodes) {
				const reach = Math.max(d.r, 3);
				const dist = Math.hypot(d.x - x, d.y - y);
				if (dist <= reach && (!best || dist / reach < best.score)) best = { d, score: dist / reach };
			}
			return best && best.d;
		}

		function setHover(event) {
			const d = nodeAt(event);
			const county = d ? d.county : null;
			if (county !== hovered) {
				hovered = county;
				draw();
			}
			if (d) {
				const title = county.population
					? `${county.name} (population ${fmt(county.population)})` : county.name;
				tooltip.show(event, breakdownHTML(title, county.counts, county.total, d.term));
			}
			else tooltip.hide();
		}

		function clearHover() {
			hovered = null;
			tooltip.hide();
			draw();
		}

		canvas.addEventListener("pointermove", setHover);
		canvas.addEventListener("pointerdown", setHover);
		canvas.addEventListener("pointerleave", (event) => {
			if (event.pointerType === "mouse") clearHover();
		});
		document.addEventListener("pointerdown", (event) => {
			if (event.target !== canvas) clearHover();
		});

		slider.addEventListener("input", () => {
			scale = +slider.value;
			updateSizeKey();
		});
		slider.addEventListener("change", start);
		sizeInputs.forEach((el) => el.addEventListener("change", start));
		circleInputs.forEach((el) => el.addEventListener("change", start));
		outlinesInput.addEventListener("change", start);
		regionInputs.forEach((el) => el.addEventListener("change", start));
		document.getElementById("replay").addEventListener("click", start);

		start();
	});
})();
