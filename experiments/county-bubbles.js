// County bubbles: four circles per county (pop / soda / coke / other), area
// proportional to the number of responses, spread apart with a force layout.
// Or one circle per county, colored with the main map's CMY mix. Optionally
// each state is outlined, its border swelling to hold its own bubbles.
// Drawn on canvas: there are ~9,000 circles and they move while settling.
// The circles grow from nothing while the layout runs, starting in the south
// and rising northward like bubbles in a glass.

(function () {
	"use strict";

	const { TERMS, LABEL, COLOR, fmt, loadData, breakdownHTML, makeTooltip, mixCounts, mixKeyHTML, swellingOutlines, separateStates, drawBasemap } = PVS;
	// Same colors as the 90% areas on the isogloss map: the CMY fills as they
	// look after three stacked 30% bands over the land (and a gray for
	// "other"), outlined in the darker line colors from common.js.
	const FILL = { pop: "#fbfb54", soda: "#54fbfb", coke: "#fb54fb", other: "#b9b9b9" };
	const OUTLINE = COLOR;
	const WIDTH = 960, HEIGHT = 600;
	const PADDING = 0.4; // px between touching circles
	const STATE_GAP = 5; // px between circles from different states, with outlines on

	// Each circle grows from zero to full size over GROW_MS. When it starts
	// depends on its county's latitude: the southernmost start at once, the
	// northernmost after STAGGER_MS, when the southern ones are full grown.
	// The stagger spans the lower 48 (Hawaii starts with the far south,
	// Alaska with the far north), so the wave moves steadily up the map.
	const GROW_MS = 5000;
	const STAGGER_MS = 5000;
	const SOUTH_LAT = 25, NORTH_LAT = 49;
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

	Promise.all([
		loadData("../"),
		d3.csv("../data/county_population_2010.csv"),
		d3.json("../vendor/naturalearth-5.1.2-lakes-50m-north-america.geojson"),
	]).then(([data, popRows, lakes]) => {
		const population = new Map(popRows.map((r) => [+r.county_fips, +r.population_2010]));
		const projection = d3.geoAlbersUsa().fitExtent([[10, 10], [WIDTH - 10, HEIGHT - 10]], data.land);
		const path = d3.geoPath(projection);
		const landPath = new Path2D(path(data.land));
		const lakePath = new Path2D(path(lakes));
		const statePath = new Path2D(path(data.stateMesh));

		const featureById = new Map(data.countyFeatures.map((f) => [+f.id, f]));

		// One node per (county, term) with at least one response, or (blended)
		// one node per county.
		const perAnswer = [], perCounty = [];
		for (const c of data.counties) {
			const f = featureById.get(c.id);
			if (!f) continue;
			const [hx, hy] = path.centroid(f);
			if (!isFinite(hx)) continue;
			const lat = d3.geoCentroid(f)[1];
			c.population = population.get(c.id) || 0;
			const delay = reducedMotion ? 0
				: STAGGER_MS * Math.min(1, Math.max(0, (lat - SOUTH_LAT) / (NORTH_LAT - SOUTH_LAT)));
			const stateKey = +c.state;
			for (const t of TERMS) {
				// `people`: the county's population split in proportion to its answers.
				if (c.counts[t] > 0) perAnswer.push({
					county: c, term: t, n: c.counts[t], homeX: hx, homeY: hy, delay, stateKey,
					people: c.population * c.counts[t] / c.total,
					fill: FILL[t], stroke: OUTLINE[t], offset: START_OFFSET[t],
				});
			}
			if (c.total > 0) perCounty.push({
				county: c, term: null, n: c.total, homeX: hx, homeY: hy, delay, stateKey,
				people: c.population,
				fill: mixCounts(c.counts, c.total), stroke: BLEND_OUTLINE, offset: [0, 0],
			});
		}
		let nodes = perAnswer;
		let outlines = null;
		const stateShapes = data.stateFeatures.map((f) => ({ key: +f.id, feature: f }));

		// In population mode, people are scaled by the ratio of responses to
		// population over the mapped counties, so both modes put about the same
		// total area on the map and share the size slider.
		const PEOPLE_PER_RESPONSE = d3.sum(perAnswer, (d) => d.people) / d3.sum(perAnswer, (d) => d.n);
		const sizeValue = (d) => (sizeBy() === "population" ? d.people / PEOPLE_PER_RESPONSE : d.n);

		let scale = +slider.value; // px of radius per sqrt(response)
		let hovered = null;        // county record under the pointer

		function draw() {
			ctx.clearRect(0, 0, WIDTH, HEIGHT);
			drawBasemap(ctx, { land: landPath, lakes: lakePath, admin: outlines ? null : statePath });
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
						? `, sized by ${fmt(Math.round(d3.sum(nodes, (d) => d.people)))} people (2010 census). `
						: ". ") +
					"Hover over (or tap) a circle for its county.";
			});

		// Stop bubbles from being pushed off the edge of the map.
		function keepOnCanvas() {
			for (const d of nodes) {
				d.x = Math.max(d.r, Math.min(WIDTH - d.r, d.x));
				d.y = Math.max(d.r, Math.min(HEIGHT - d.r, d.y));
			}
		}

		function start() {
			nodes = blended() ? perCounty : perAnswer;
			hovered = null;
			document.getElementById("color-key").innerHTML = blended() ? mixKeyHTML() : termKeyHTML;
			// A blended circle holds a whole county, so at the same slider
			// setting it has the area of that county's four separate circles.
			for (const d of nodes) {
				d.fullR = scale * Math.sqrt(sizeValue(d));
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
			const big = scale * Math.sqrt(sizes[sizes.length - 1] * unit);
			const key = d3.select("#size-key").html("");
			const svg = key.append("svg").attr("width", big * 2 + (byPeople ? 76 : 50)).attr("height", big * 2 + 4);
			const g = svg.append("g").attr("transform", `translate(${big + 2},${big * 2 + 2})`);
			for (const v of sizes) {
				const r = scale * Math.sqrt(v * unit);
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
		document.getElementById("replay").addEventListener("click", start);

		start();
	});
})();
