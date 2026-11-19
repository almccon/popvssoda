// Hex bubbles: the ZIP code and FSA points are first gathered into a grid of
// equal hexagons, then each hexagon gets up to four circles (pop / soda /
// coke / other) with area proportional to its responses, spread apart with a
// force layout. Like county bubbles, but starting from areas of one regular
// size rather than counties, which vary enormously. The circles grow in from
// the south while the layout runs. With outlines on, hexagons are split at
// state and province lines and each state is outlined, its border swelling to
// hold its own bubbles.

(function () {
	"use strict";

	const { TERMS, LABEL, COLOR, fmt, breakdownHTML, makeTooltip, northAmericaProjection, swellingOutlines, separateStates } = PVS;
	// Same colors as county bubbles (the isogloss map's 90% areas).
	const FILL = { pop: "#fbfb54", soda: "#54fbfb", coke: "#fb54fb", other: "#b9b9b9" };
	const OUTLINE = COLOR;
	const WIDTH = 960, HEIGHT = 700;
	const PADDING = 0.4; // px between touching circles
	const STATE_GAP = 5; // px between circles from different states, with outlines on
	const SQRT3 = Math.sqrt(3);
	const EARTH_KM = 6371;
	const KM_PER_MILE = 1.609344;

	// Growth: each circle grows over GROW_MS, starting up to STAGGER_MS late
	// depending on latitude. The stagger runs from the Gulf coast to central
	// Canada; the Hawaii inset starts with the far south.
	const GROW_MS = 5000;
	const STAGGER_MS = 5000;
	const SOUTH_LAT = 25, NORTH_LAT = 55;
	const grow = d3.easeQuadOut;
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	const START_OFFSET = {
		pop: [-0.7, -0.7], soda: [0.7, -0.7], coke: [0.7, 0.7], other: [-0.7, 0.7],
	};

	const canvas = document.getElementById("canvas");
	const ctx = canvas.getContext("2d");
	const statusEl = document.getElementById("status");
	const slider = document.getElementById("size");
	const sliderValue = document.getElementById("size-value");
	const hexInput = document.getElementById("hex");
	const hexValue = document.getElementById("hex-value");
	const showHexes = document.getElementById("show-hexes");
	const outlinesInput = document.getElementById("outlines");
	const tooltip = makeTooltip(document.getElementById("chart"));
	document.getElementById("color-key").innerHTML = TERMS.map((t) =>
		`<span class="key-item"><span class="disc" style="background:${FILL[t]};` +
		`box-shadow:inset 0 0 0 1px ${OUTLINE[t]}"></span>${LABEL[t]}</span>`
	).join("");

	const dpr = window.devicePixelRatio || 1;
	canvas.width = WIDTH * dpr;
	canvas.height = HEIGHT * dpr;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	Promise.all([
		d3.json("../vendor/world-atlas-2.0.2-countries-50m.json"),
		d3.json("../vendor/naturalearth-5.1.2-admin1-50m-us-canada.geojson"),
		d3.json("../vendor/naturalearth-5.1.2-lakes-50m-north-america.geojson"),
		d3.csv("../data/postal_counts.csv"),
	]).then(([world, admin1, lakes, rows]) => {
		const naGeoms = world.objects.countries.geometries.filter((g) => g.id === "840" || g.id === "124");
		const { projection } = northAmericaProjection(WIDTH, HEIGHT);
		const stateShapes = admin1.features.map((f) => ({ key: `${f.properties.country}-${f.properties.postal}`, feature: f }));
		const knownStates = new Set(stateShapes.map((s) => s.key));
		const path = d3.geoPath(projection);
		const landPath = new Path2D(path(topojson.merge(world, naGeoms)));
		const adminPath = new Path2D(path(admin1));
		const lakePath = new Path2D(path(lakes));

		const points = [];
		for (const r of rows) {
			if (!r.lat) continue;
			const xy = projection([+r.lon, +r.lat]);
			if (!xy || xy[0] < 0 || xy[0] > WIDTH || xy[1] < 0 || xy[1] > HEIGHT) continue;
			const counts = {};
			for (const t of TERMS) counts[t] = +r[t];
			const stateKey = `${r.country}-${r.state}`;
			points.push({ x: xy[0], y: xy[1], counts, stateKey: knownStates.has(stateKey) ? stateKey : null });
		}
		const totalResponses = d3.sum(points, (p) => d3.sum(TERMS, (t) => p.counts[t]));

		// km per pixel near the middle of the lower 48, for the hex size label.
		const mid = projection([-95, 39]);
		const kmPerPx = d3.geoDistance(projection.invert(mid), projection.invert([mid[0] + 1, mid[1]])) * EARTH_KM;

		let hexes = [];
		let nodes = [];
		let hexR = +hexInput.value; // hexagon radius (center to corner), px
		let outlines = null;

		// Pointy-top hexagons in pixel space: axial coordinates, rounded via
		// cube coordinates.
		function binPoints() {
			const bins = new Map();
			const split = outlinesInput.checked; // one bin per hexagon and state
			for (const p of points) {
				const qf = (SQRT3 / 3 * p.x - p.y / 3) / hexR;
				const rf = (2 / 3 * p.y) / hexR;
				let q = Math.round(qf), r = Math.round(rf), s = Math.round(-qf - rf);
				const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf);
				if (dq > dr && dq > ds) q = -r - s;
				else if (dr > ds) r = -q - s;
				const cell = q + "," + r;
				const key = split ? cell + "," + p.stateKey : cell;
				let h = bins.get(key);
				if (!h) {
					const x = hexR * SQRT3 * (q + r / 2), y = hexR * 1.5 * r;
					h = {
						x, y, cell, stateKey: p.stateKey, codes: 0, sx: 0, sy: 0,
						counts: { pop: 0, soda: 0, coke: 0, other: 0 }, total: 0,
					};
					const [lon, lat] = projection.invert([x, y]);
					h.lon = lon; h.lat = lat;
					bins.set(key, h);
				}
				h.codes++;
				h.sx += p.x;
				h.sy += p.y;
				for (const t of TERMS) h.counts[t] += p.counts[t];
			}
			hexes = [...bins.values()];
			// A hexagon split between states: each part starts at the mean of its
			// own points, so it begins on its own side of the line.
			const parts = d3.rollup(hexes, (v) => v.length, (h) => h.cell);
			for (const h of hexes) {
				h.homeX = h.x;
				h.homeY = h.y;
				if (parts.get(h.cell) > 1) {
					h.homeX = h.sx / h.codes;
					h.homeY = h.sy / h.codes;
				}
			}
			nodes = [];
			for (const h of hexes) h.total = d3.sum(TERMS, (t) => h.counts[t]);
			const busy = d3.quantile(hexes.map((h) => h.total).sort(d3.ascending), 0.9);
			fit = Math.sqrt((1.5 * SQRT3 * hexR * hexR) / (Math.PI * busy));
			setScale();
			for (const h of hexes) {
				const delay = reducedMotion ? 0
					: STAGGER_MS * Math.min(1, Math.max(0, (h.lat - SOUTH_LAT) / (NORTH_LAT - SOUTH_LAT)));
				for (const t of TERMS) {
					if (h.counts[t] > 0) nodes.push({ hex: h, term: t, n: h.counts[t], homeX: h.homeX, homeY: h.homeY, delay, stateKey: h.stateKey });
				}
			}
		}

		const hexCorners = (h) => d3.range(6).map((i) => {
			const a = Math.PI / 6 + (i * Math.PI) / 3;
			return [h.x + hexR * Math.cos(a), h.y + hexR * Math.sin(a)];
		});

		// Circle sizes follow the hexagon size: at slider 1, a hexagon with the
		// 90th-percentile number of responses has circles whose total area equals
		// the hexagon's. The slider multiplies that.
		let fit = 1;   // px of radius per sqrt(response) at slider 1
		let scale = 1; // px of radius per sqrt(response)
		const setScale = () => { scale = +slider.value * fit; };
		let hovered = null;        // hexagon under the pointer

		function draw() {
			ctx.clearRect(0, 0, WIDTH, HEIGHT);
			ctx.fillStyle = "#f7f7f7";
			ctx.fill(landPath, "evenodd");
			ctx.fillStyle = "#fff";
			ctx.fill(lakePath);
			ctx.strokeStyle = "#e2e2e2";
			ctx.lineWidth = 0.75;
			if (!outlines) ctx.stroke(adminPath);
			ctx.stroke(lakePath);
			ctx.strokeStyle = "#d0d0d0";
			ctx.lineWidth = 1;
			ctx.stroke(landPath);
			// Under the bubbles, so stretches of border that wander under other
			// states' bubbles are hidden.
			if (outlines) outlines.draw(ctx);

			if (showHexes.checked) {
				ctx.beginPath();
				for (const h of hexes) {
					const c = hexCorners(h);
					ctx.moveTo(c[0][0], c[0][1]);
					for (let i = 1; i < 6; i++) ctx.lineTo(c[i][0], c[i][1]);
					ctx.closePath();
				}
				ctx.strokeStyle = "#ccc";
				ctx.lineWidth = 0.5;
				ctx.stroke();
			}

			for (const t of TERMS) {
				ctx.beginPath();
				for (const d of nodes) {
					if (d.term !== t || d.r <= 0) continue;
					ctx.moveTo(d.x + d.r, d.y);
					ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
				}
				ctx.globalAlpha = hovered ? 0.35 : 1;
				ctx.fillStyle = FILL[t];
				ctx.fill();
				ctx.lineWidth = 0.75;
				ctx.strokeStyle = OUTLINE[t];
				ctx.stroke();
			}
			ctx.globalAlpha = 1;

			if (hovered) {
				ctx.beginPath();
				const c = hexCorners(hovered);
				ctx.moveTo(c[0][0], c[0][1]);
				for (let i = 1; i < 6; i++) ctx.lineTo(c[i][0], c[i][1]);
				ctx.closePath();
				ctx.strokeStyle = "#555";
				ctx.lineWidth = 1;
				ctx.stroke();
				for (const d of nodes) {
					if (d.hex !== hovered) continue;
					ctx.beginPath();
					ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
					ctx.fillStyle = FILL[d.term];
					ctx.fill();
					ctx.lineWidth = 1.5;
					ctx.strokeStyle = "#222";
					ctx.stroke();
				}
			}
		}

		let startTime = 0;
		function growCircles(elapsed) {
			let done = true;
			for (const d of nodes) {
				const k = Math.min(1, Math.max(0, (elapsed - d.delay) / GROW_MS));
				if (k < 1) done = false;
				d.r = d.fullR * (reducedMotion ? 1 : grow(k));
			}
			simulation.force("collide").radius((d) => d.r + PADDING);
			return done;
		}

		let growing = false;
		const simulation = d3.forceSimulation()
			.force("x", d3.forceX((d) => d.homeX).strength(0.08))
			.force("y", d3.forceY((d) => d.homeY).strength(0.08))
			.force("collide", d3.forceCollide((d) => d.r + PADDING).iterations(2))
			.alphaDecay(0.03)
			.stop()
			.on("tick", () => {
				if (growing) {
					const elapsed = performance.now() - startTime;
					if (growCircles(elapsed)) {
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
				statusEl.textContent = `${fmt(hexes.length)} hexagons, ${fmt(nodes.length)} circles for ` +
					`${fmt(totalResponses)} responses from ${fmt(points.length)} ZIP codes and FSAs. ` +
					"Hover over (or tap) a circle for its hexagon.";
			});

		// Stop bubbles from being pushed off the edge of the map.
		function keepOnCanvas() {
			for (const d of nodes) {
				d.x = Math.max(d.r, Math.min(WIDTH - d.r, d.x));
				d.y = Math.max(d.r, Math.min(HEIGHT - d.r, d.y));
			}
		}

		function start() {
			for (const d of nodes) {
				d.fullR = scale * Math.sqrt(d.n);
				const [ox, oy] = START_OFFSET[d.term];
				d.x = d.homeX + ox;
				d.y = d.homeY + oy;
				d.vx = d.vy = 0;
			}
			simulation.nodes(nodes);
			outlines = outlinesInput.checked
				? swellingOutlines(stateShapes, projection, nodes, { width: WIDTH, height: HEIGHT, dpr })
				: null;
			simulation.force("states", outlines ? separateStates(STATE_GAP) : null);
			startTime = performance.now();
			growing = !reducedMotion;
			growCircles(reducedMotion ? Infinity : 0);
			simulation.alphaTarget(growing ? 0.3 : 0).alpha(1).restart();
			updateKeys();
		}

		function rebin() {
			hexR = +hexInput.value;
			hovered = null;
			binPoints();
			start();
		}

		function updateKeys() {
			sliderValue.textContent = `×${(+slider.value).toFixed(2)}`;
			const across = hexR * SQRT3 * kmPerPx; // flat side to flat side
			hexValue.textContent = `${Math.round(across / KM_PER_MILE)} miles (${Math.round(across)} km) across`;
			const top = d3.max(hexes, (h) => h.total) || 1;
			const nice = [10, 50, 100, 500, 1000, 5000, 10000, 50000];
			const sizes = nice.filter((v) => v <= top).slice(-3);
			const big = scale * Math.sqrt(sizes[sizes.length - 1]);
			const key = d3.select("#size-key").html("");
			const svg = key.append("svg").attr("width", big * 2 + 50).attr("height", big * 2 + 4);
			const g = svg.append("g").attr("transform", `translate(${big + 2},${big * 2 + 2})`);
			for (const v of sizes) {
				const r = scale * Math.sqrt(v);
				g.append("circle").attr("cy", -r).attr("r", r);
				g.append("line")
					.attr("x1", 0).attr("x2", big + 6)
					.attr("y1", -2 * r).attr("y2", -2 * r)
					.attr("stroke", "#bbb").attr("stroke-dasharray", "2,2");
				g.append("text").attr("x", big + 8).attr("y", -2 * r).attr("dy", "0.35em").text(fmt(v));
			}
			key.append("span").text("responses");
		}

		// ---- Hover ------------------------------------------------------------

		function nodeAt(event) {
			const rect = canvas.getBoundingClientRect();
			const x = ((event.clientX - rect.left) * WIDTH) / rect.width;
			const y = ((event.clientY - rect.top) * HEIGHT) / rect.height;
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
			const hex = d ? d.hex : null;
			if (hex !== hovered) {
				hovered = hex;
				draw();
			}
			if (d) {
				const where = `${Math.abs(hex.lat).toFixed(1)}°${hex.lat >= 0 ? "N" : "S"}, ` +
					`${Math.abs(hex.lon).toFixed(1)}°${hex.lon <= 0 ? "W" : "E"}`;
				const title = `${fmt(hex.codes)} ZIP code${hex.codes === 1 ? "" : "s"} / FSAs around ${where}`;
				tooltip.show(event, breakdownHTML(title, hex.counts, hex.total, d.term));
			} else tooltip.hide();
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
			setScale();
			updateKeys();
		});
		slider.addEventListener("change", start);
		hexInput.addEventListener("input", () => {
			hexR = +hexInput.value;
			updateKeys();
		});
		hexInput.addEventListener("change", rebin);
		showHexes.addEventListener("change", draw);
		outlinesInput.addEventListener("change", rebin);
		document.getElementById("replay").addEventListener("click", start);

		rebin();
	}).catch((err) => {
		statusEl.textContent = "Couldn't load data: " + err.message;
		throw err;
	});
})();
