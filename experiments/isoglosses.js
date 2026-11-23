// Isoglosses from a moving-window analysis of the ZIP / FSA counts.
//
// For every cell of a grid laid over the map, gather the responses "near"
// that cell and work out each term's share; then contour those shares at
// 50 / 75 / 90% (and, for "other", which rarely reaches a majority, also at
// 10 / 25 / 33%, shown as lines over a dot pattern that thickens at each
// level; where "other" does pass 50% it gets gray bands like the others). Three ways of deciding what "near" means:
//
//   fixed     every response within a fixed radius counts equally
//   gaussian  every response counts, weighted by a Gaussian of its distance
//             (the slider sets the standard deviation)
//   adaptive  the window grows from each cell until it holds N responses,
//             so it stays small in cities and widens on the Plains
(function () {
	"use strict";

	const { fmt, LABEL, breakdownHTML, makeTooltip } = window.PVS;
	const { width: WIDTH, height: HEIGHT } = window.PVS.FRAME;
	const KM_PER_MILE = 1.609344;
	const EARTH_KM = 6371;
	// Pop, soda and coke get filled bands and lines at the majority levels.
	// "Other" rarely reaches a majority, so it is drawn as gray lines only,
	// starting much lower; its 10 / 25 / 33% lines always show with it.
	const LEVELS = [0.5, 0.75, 0.9];
	const OTHER_MINOR_LEVELS = [0.1, 0.25, 1 / 3];
	const OTHER_LEVELS = [...OTHER_MINOR_LEVELS, ...LEVELS];
	const TERMS = ["pop", "soda", "coke", "other"];
	// Pure CMY for the fills (multiplied together like inks) and a neutral gray
	// for "other"; darker relatives from common.js for the lines.
	const FILL = { pop: "#ffff00", soda: "#00ffff", coke: "#ff00ff", other: "#9a9a9a" };
	const LINE = window.PVS.COLOR;
	const BAND_OPACITY = 0.3; // nested bands stack: ~30% / 51% / 66%
	const LINE_WIDTH = { 0.5: 0.6, 0.75: 1.1, 0.9: 1.8 };
	const OTHER_LINE_WIDTH = { 0.1: 0.6, 0.25: 1.1, [1 / 3]: 1.6, 0.5: 2.1, 0.75: 2.6, 0.9: 3.1 };
	const isMinor = (level) => OTHER_MINOR_LEVELS.includes(level);
	// Dots for other's minor levels, on a triangular grid. A triangular grid
	// splits into three interleaved triangular sub-grids; each level gets one,
	// so the nested areas read sparse / denser / densest, and inside the 33%
	// line the three together make the full grid with dots DOT_GAP px apart.
	const DOT_GAP = 3;
	const DOT_R = 0.7;
	const DOT_OPACITY = 0.6;
	const levelLabel = (l) => `${Math.round(l * 100)}%`;

	// Per-method slider wording, ranges ([min, max, step]) and defaults, applied
	// when switching method.
	const METHODS = {
		fixed: {
			radiusLabel: "Window radius", radiusRange: [5, 300, 5], radius: 20,
			minLabel: "Leave blank where the window has fewer than", minRange: [1, 200, 1], min: 10,
		},
		gaussian: {
			radiusLabel: "Smoothing distance (Gaussian σ)", radiusRange: [5, 400, 5], radius: 50,
			minLabel: "Leave blank where the weighted count is below", minRange: [1, 200, 1], min: 20,
		},
		adaptive: {
			radiusLabel: "Largest window allowed", radiusRange: [25, 1000, 25], radius: 600,
			minLabel: "Grow each window until it holds", minRange: [25, 3000, 25], min: 600,
		},
	};
	function applyMethodRanges(method, resetValues) {
		const m = METHODS[method];
		for (const [input, range, value] of [[radiusInput, m.radiusRange, m.radius], [minInput, m.minRange, m.min]]) {
			[input.min, input.max, input.step] = range;
			if (resetValues) input.value = value;
		}
	}

	const svg = d3.select("#svg");
	const chart = document.getElementById("chart");
	const status = document.getElementById("status");
	const radiusInput = document.getElementById("radius");
	const radiusName = document.getElementById("radius-name");
	const radiusLabel = document.getElementById("radius-label");
	const minInput = document.getElementById("min-n");
	const minName = document.getElementById("min-n-name");
	const minLabel = document.getElementById("min-n-label");
	const methodInputs = document.querySelectorAll("input[name=method]");
	const tooltip = makeTooltip(chart);

	const currentMethod = () => [...methodInputs].find((el) => el.checked).value;

	const updateLabels = () => {
		const m = METHODS[currentMethod()];
		radiusName.textContent = m.radiusLabel;
		minName.textContent = m.minLabel;
		const mi = +radiusInput.value;
		radiusLabel.textContent = `${mi} miles (${Math.round(mi * KM_PER_MILE)} km)`;
		const n = +minInput.value;
		minLabel.textContent = `${n} response${n === 1 ? "" : "s"}`;
	};

	// Key doubles as the visibility toggles.
	const otherSample = `<svg width="24" height="10">` +
		[0, 1, 2, 3, 4, 5, 6].map((i) => `<circle cx="${3 + i * 3}" cy="${i % 2 ? 6.5 : 3.5}" r="${DOT_R + 0.1}" fill="${LINE.other}" opacity="${DOT_OPACITY}"/>`).join("") +
		`<rect x="0" y="0" width="24" height="10" fill="none" stroke="${LINE.other}" stroke-width="0.8"/></svg>`;
	document.getElementById("key").innerHTML =
		TERMS.map((t) => t === "other"
			? `<label class="key-item"><input type="checkbox" data-term="other" checked>${otherSample}` +
				`Other (dots and lines at ${OTHER_MINOR_LEVELS.map(levelLabel).join(", ")}; filled above 50%)</label>`
			: `<label class="key-item"><input type="checkbox" data-term="${t}" checked>` +
				`<span class="swatch" style="background:${FILL[t]};opacity:0.66"></span>${LABEL[t]}</label>`
		).join("") +
		LEVELS.map((l) =>
			`<label class="key-item"><input type="checkbox" data-level="${l}" checked>` +
			`<span class="line-sample" style="border-top-width:${LINE_WIDTH[l] + 0.4}px"></span>&gt;${levelLabel(l)}</label>`
		).join("");
	const keyBoxes = document.querySelectorAll("#key input[type=checkbox]");

	// The main map's triangle legend, drawn the isogloss way: in the triangle
	// of pop / soda / coke shares, each term's 50%, 75% and 90% areas are the
	// nested corner triangles, filled and outlined exactly as on the map. Beside
	// it, nested blobs show "other": dots at 10%, 25% and 33%, filled above 50%.
	// Uses the dot patterns from the map's <defs>, so call it after those exist.
	function addIsoKey() {
		const width = 150;
		const text = (x, y, str, anchor = "middle") =>
			`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${str}</text>`;

		// "Other", on top: nested circles, outermost 10%, then 25%, 33% and filled
		// at 50%. Each sits well off the center of the one around it (but doesn't
		// touch it), the way the map's nested areas do. Labels sit in a column on
		// the right, each with a level leader to the edge of its own circle.
		const ox = 48, oy = 40; // center of the outer circle
		const rings = [
			{ l: 0.1, r: 30, x: ox, y: oy, ly: oy - 18 },
			{ l: 0.25, r: 22, x: ox - 3, y: oy + 4, ly: oy - 7 },
			{ l: 1 / 3, r: 14, x: ox - 1, y: oy + 8, ly: oy + 4 },
			{ l: 0.5, r: 7, x: ox - 4, y: oy + 11, ly: oy + 15 },
		];
		const circle = (c, attrs) => `<circle cx="${c.x}" cy="${c.y}" r="${c.r}" ${attrs}/>`;
		let oth = text(ox, 6, "other");
		rings.forEach((c, k) => {
			oth += isMinor(c.l)
				? circle(c, `fill="url(#other-dots-${k})"`)
				: circle(c, `class="iso-band" fill="${FILL.other}" fill-opacity="${BAND_OPACITY}"`);
		});
		for (const c of rings) oth += circle(c, `fill="none" stroke="${LINE.other}" stroke-width="${OTHER_LINE_WIDTH[c.l]}"`);
		const labelX = ox + 30 + 8;
		for (const c of rings) {
			const edge = c.x + Math.sqrt(c.r * c.r - (c.ly - c.y) ** 2);
			oth += `<line x1="${edge.toFixed(1)}" y1="${c.ly}" x2="${labelX - 2}" y2="${c.ly}" stroke="#999" stroke-width="0.5"/>` +
				text(labelX, c.ly + 3, levelLabel(c.l), "start");
		}

		// Pop / soda / coke, below: in the triangle of shares, each term's 50%,
		// 75% and 90% areas are its nested corner triangles.
		const side = 76, h = (side * Math.sqrt(3)) / 2;
		const top = [56, 96], base = top[1] + h;
		const corner = { soda: top, pop: [top[0] - side / 2, base], coke: [top[0] + side / 2, base] };
		const at = (q) => ["soda", "pop", "coke"].reduce(
			(acc, t) => [acc[0] + (q[t] || 0) * corner[t][0], acc[1] + (q[t] || 0) * corner[t][1]], [0, 0]);
		const pts = (list) => list.map((q) => at(q).map((v) => v.toFixed(1)).join(",")).join(" ");
		const others = { pop: ["soda", "coke"], soda: ["pop", "coke"], coke: ["pop", "soda"] };
		let tri = `<polygon points="${pts([{ soda: 1 }, { pop: 1 }, { coke: 1 }])}" fill="#f7f7f7" stroke="#d6d6d6"/>`;
		for (const t of ["pop", "soda", "coke"]) {
			for (const l of LEVELS) {
				const [a, b] = others[t];
				tri += `<polygon class="iso-band" points="${pts([{ [t]: 1 }, { [t]: l, [a]: 1 - l }, { [t]: l, [b]: 1 - l }])}" ` +
					`fill="${FILL[t]}" fill-opacity="${BAND_OPACITY}"/>` +
					`<polyline points="${pts([{ [t]: l, [a]: 1 - l }, { [t]: l, [b]: 1 - l }])}" fill="none" ` +
					`stroke="${LINE[t]}" stroke-width="${LINE_WIDTH[l]}"/>`;
			}
		}
		tri += text(top[0], top[1] - 5, "soda") + text(corner.pop[0] - 4, base + 13, "pop") +
			text(corner.coke[0] + 4, base + 13, "coke");
		for (const l of LEVELS) { // where soda's lines meet the right-hand edge
			const [x, y] = at({ soda: l, coke: 1 - l });
			tri += text(x + 4, y + 3, levelLabel(l), "start");
		}

		const height = Math.ceil(base + 17);
		const el = document.createElement("div");
		el.className = "map-key";
		el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" style="width:${((width * 1.2) / WIDTH) * 100}%" ` +
			`role="img" aria-label="Key: nested blobs for other at 10, 25, 33 and 50 percent; nested triangles ` +
			`for where pop, soda or coke reaches 50, 75 and 90 percent">${oth}${tri}</svg>`;
		chart.append(el);
	}

	// The region is set up once at load, so switching reloads with the settings kept.
	document.querySelectorAll("input[name=region]").forEach((el) => el.addEventListener("change", PVS.reloadWithSettings));

	Promise.all([
		d3.json("../vendor/world-atlas-2.0.2-countries-50m.json"),
		d3.json("../vendor/naturalearth-5.1.2-admin1-50m-us-canada.geojson"),
		d3.json("../vendor/naturalearth-5.1.2-lakes-50m-north-america.geojson"),
		d3.csv("../data/postal_counts.csv"),
	]).then(([world, admin1All, lakes, rows]) => {
		// The region (US and Canada, or one alone) is set at load; switching
		// reloads the page with the other settings kept.
		const which = PVS.pageRegion();
		const countries = which === "both" ? ["US", "CA"] : [which];
		const countryIds = { US: "840", CA: "124" };
		const naGeoms = world.objects.countries.geometries.filter((g) => countries.some((c) => countryIds[c] === g.id));
		const admin1 = { type: "FeatureCollection", features: admin1All.features.filter((f) => countries.includes(f.properties.country)) };
		const land = topojson.merge(world, naGeoms);

		// Same frame as the Voronoi page, with Hawaii moved in close to the
		// mainland. Hawaii's responses and the mainland's never mix: each point
		// and grid cell has a zone (1 = the Hawaii inset), and windows only
		// gather points from their own zone.
		const projection = PVS.regionProjection(which);
		const zones = PVS.regionZones(which); // keeps inset (Alaska, Hawaii) points apart
		const path = d3.geoPath(projection);

		// The projection is conformal, so a circle on the ground is (locally) a
		// circle on the map; we just need the local scale in km per pixel.
		const kmPerPxAt = (x, y) =>
			d3.geoDistance(projection.invert([x, y]), projection.invert([x + 1, y])) * EARTH_KM;

		const points = [];
		for (const r of rows) {
			if (!r.lat || !countries.includes(r.country)) continue;
			const xy = projection([+r.lon, +r.lat]);
			if (!xy || xy[0] < 0 || xy[0] > WIDTH || xy[1] < 0 || xy[1] > HEIGHT) continue;
			points.push({
				x: xy[0], y: xy[1], kmPerPx: kmPerPxAt(xy[0], xy[1]), zone: zones.ofLonLat(+r.lon, +r.lat),
				total: +r.total, pop: +r.pop, soda: +r.soda, coke: +r.coke,
			});
		}

		const medianKmPerPx = d3.median(points, (p) => p.kmPerPx);

		// Bucket index for the adaptive search.
		const BUCKET = 8; // px
		const BW = Math.ceil(WIDTH / BUCKET), BH = Math.ceil(HEIGHT / BUCKET);
		const buckets = Array.from({ length: BW * BH }, () => []);
		for (const p of points) {
			buckets[Math.min(BH - 1, Math.floor(p.y / BUCKET)) * BW + Math.min(BW - 1, Math.floor(p.x / BUCKET))].push(p);
		}

		// --- static layers ---------------------------------------------------
		const defs = svg.append("defs");
		// Bands, dots and lines show only on the land shown, minus lakes. A mask
		// rather than an even-odd clip: with one country shown its land stops
		// mid-lake, and an even-odd clip would fill the other country's half.
		const landMask = defs.append("mask").attr("id", "land-mask")
			.attr("maskUnits", "userSpaceOnUse").attr("x", 0).attr("y", 0).attr("width", WIDTH).attr("height", HEIGHT);
		landMask.append("path").attr("fill", "#fff").attr("d", path(land));
		landMask.append("path").attr("fill", "#000").attr("d", path(lakes));

		// Sub-grid spacing is DOT_GAP * sqrt(3), in horizontal rows; the three
		// sub-grids are shifted 0, 1 and 2 * DOT_GAP straight down.
		const subGap = DOT_GAP * Math.sqrt(3);
		const tileW = subGap, tileH = subGap * Math.sqrt(3); // two rows
		OTHER_MINOR_LEVELS.forEach((l, k) => {
			const pattern = defs.append("pattern")
				.attr("id", `other-dots-${k}`)
				.attr("patternUnits", "userSpaceOnUse")
				.attr("width", tileW).attr("height", tileH);
			for (const [x0, y0] of [[0, 0], [tileW / 2, tileH / 2]]) {
				const y = (y0 + k * DOT_GAP) % tileH;
				// Repeat across the tile edges so dots on a seam aren't cut in half.
				for (const dx of [-tileW, 0, tileW]) {
					for (const dy of [-tileH, 0, tileH]) {
						pattern.append("circle")
							.attr("cx", x0 + dx).attr("cy", y + dy).attr("r", DOT_R)
							.attr("fill", LINE.other).attr("fill-opacity", DOT_OPACITY);
					}
				}
			}
		});

		addIsoKey();
		PVS.addCredit(chart, which);

		const base = svg.append("g").attr("class", "basemap");
		base.append("path").attr("class", "land").attr("d", path(land));
		base.append("path").attr("class", "admin").attr("d", path(admin1));
		// Lakes only inside the land shown, so a hidden country's lakes don't float.
		defs.append("clipPath").attr("id", "shown-land").append("path").attr("d", path(land));
		base.append("path").attr("class", "lakes").attr("clip-path", "url(#shown-land)").attr("d", path(lakes));

		const bands = svg.append("g").attr("mask", "url(#land-mask)");
		const dots = svg.append("g").attr("mask", "url(#land-mask)");
		const lines = svg.append("g").attr("mask", "url(#land-mask)");
		// State / province lines again on top, faintly, so they read through the bands.
		svg.append("path").attr("class", "admin-over").attr("d", path(admin1));

		// --- window methods --------------------------------------------------
		// Each returns a grid: { step, w, h, total, pop, soda, coke, radiusKm? },
		// where cell (i, j) is centred on pixel ((i + 0.5) * step, (j + 0.5) * step).
		function newGrid(step) {
			const w = Math.ceil(WIDTH / step), h = Math.ceil(HEIGHT / step), n = w * h;
			const zone = new Uint8Array(n);
			for (let j = 0; j < h; j++) {
				for (let i = 0; i < w; i++) zone[j * w + i] = zones.ofPx((i + 0.5) * step, (j + 0.5) * step);
			}
			return {
				step, w, h, zone,
				total: new Float32Array(n), pop: new Float32Array(n),
				soda: new Float32Array(n), coke: new Float32Array(n),
			};
		}

		// Fixed and Gaussian windows: each point "splats" its counts onto every
		// grid cell it reaches, with weight 1 (fixed) or exp(-d²/2σ²) (Gaussian,
		// cut off at 3σ, where the weight is about 1%).
		//
		// Work is proportional to the number of cells each point reaches, so wide
		// windows use a coarser grid: about 6 cells per fixed radius, or 4 per
		// Gaussian σ (the Gaussian reaches out to 3σ). The surface is smooth at
		// that scale anyway, and contours interpolate between cells.
		function splat(radiusKm, gaussian) {
			const typicalPx = radiusKm / medianKmPerPx;
			const g = newGrid(Math.max(1, Math.min(12, Math.floor(typicalPx / (gaussian ? 4 : 6)))));
			const s = g.step;
			for (const p of points) {
				// Everything below is in grid-cell units.
				const px = p.x / s, py = p.y / s;
				const rPx = radiusKm / p.kmPerPx / s;
				const reach = gaussian ? 3 * rPx : rPx;
				const reach2 = reach * reach;
				const inv2s2 = gaussian ? 1 / (2 * rPx * rPx) : 0;
				const x0 = Math.max(0, Math.ceil(px - reach - 0.5)), x1 = Math.min(g.w - 1, Math.floor(px + reach - 0.5));
				const y0 = Math.max(0, Math.ceil(py - reach - 0.5)), y1 = Math.min(g.h - 1, Math.floor(py + reach - 0.5));
				for (let y = y0; y <= y1; y++) {
					const dy = y + 0.5 - py;
					for (let x = x0; x <= x1; x++) {
						const dx = x + 0.5 - px;
						const d2 = dx * dx + dy * dy;
						if (d2 > reach2) continue;
						const i = y * g.w + x;
						if (g.zone[i] !== p.zone) continue;
						const wgt = gaussian ? Math.exp(-d2 * inv2s2) : 1;
						g.total[i] += wgt * p.total;
						g.pop[i] += wgt * p.pop;
						g.soda[i] += wgt * p.soda;
						g.coke[i] += wgt * p.coke;
					}
				}
			}
			return g;
		}

		// Adaptive window: from each cell, take ZIP / FSA points in order of
		// distance until they hold at least `target` responses. Cells that
		// can't reach the target within maxKm are left empty.
		//
		// Points are gathered ring by ring of buckets outward from the cell into
		// a histogram of distance (half-pixel bins), so no sorting is needed. After
		// each ring, every point nearer than `safe` has been seen, so the running
		// total can be read off the histogram up to that distance.
		function adaptive(target, maxKm) {
			const g = newGrid(target > 1000 ? 4 : target > 300 ? 3 : 2);
			g.radiusKm = new Float32Array(g.w * g.h);
			const BIN = 0.5; // px
			const maxBins = Math.ceil(maxKm / d3.min(points, (p) => p.kmPerPx) / BIN) + 2;
			const hTot = new Float64Array(maxBins), hPop = new Float64Array(maxBins);
			const hSoda = new Float64Array(maxBins), hCoke = new Float64Array(maxBins);
			for (let j = 0; j < g.h; j++) {
				const cy = (j + 0.5) * g.step;
				for (let i = 0; i < g.w; i++) {
					const cx = (i + 0.5) * g.step;
					const kmPerPx = kmPerPxAt(cx, cy);
					const zone = g.zone[j * g.w + i];
					const maxPx = maxKm / kmPerPx;
					const nBins = Math.min(maxBins, Math.ceil(maxPx / BIN) + 1);
					hTot.fill(0, 0, nBins); hPop.fill(0, 0, nBins);
					hSoda.fill(0, 0, nBins); hCoke.fill(0, 0, nBins);
					const bx = Math.floor(cx / BUCKET), by = Math.floor(cy / BUCKET);
					let scanned = 0, cum = 0, found = -1;
					for (let ring = 0; ; ring++) {
						for (let yy = by - ring; yy <= by + ring; yy++) {
							if (yy < 0 || yy >= BH) continue;
							const edgeRow = yy === by - ring || yy === by + ring;
							for (let xx = bx - ring; xx <= bx + ring; xx += edgeRow ? 1 : 2 * ring || 1) {
								if (xx < 0 || xx >= BW) continue;
								for (const p of buckets[yy * BW + xx]) {
									if (p.zone !== zone) continue;
									const d = Math.hypot(p.x - cx, p.y - cy);
									if (d > maxPx) continue;
									const b = Math.floor(d / BIN);
									hTot[b] += p.total; hPop[b] += p.pop; hSoda[b] += p.soda; hCoke[b] += p.coke;
								}
							}
						}
						// Points in rings beyond this one are at least `safe` px away.
						const safe = Math.min(ring * BUCKET, maxPx);
						const upTo = Math.min(nBins, Math.floor(safe / BIN));
						for (; scanned < upTo; scanned++) {
							cum += hTot[scanned];
							if (cum >= target) { found = scanned; break; }
						}
						if (found >= 0 || ring * BUCKET >= maxPx) break;
					}
					if (found < 0) continue;
					const k = j * g.w + i;
					let pop = 0, soda = 0, coke = 0;
					for (let b = 0; b <= found; b++) { pop += hPop[b]; soda += hSoda[b]; coke += hCoke[b]; }
					g.total[k] = cum;
					g.pop[k] = pop; g.soda[k] = soda; g.coke[k] = coke;
					g.radiusKm[k] = (found + 1) * BIN * kmPerPx;
				}
			}
			return g;
		}

		let grid = null;
		let layers = [];

		function render() {
			const termOn = {}, levelOn = {};
			keyBoxes.forEach((el) => {
				if (el.dataset.term) termOn[el.dataset.term] = el.checked;
				else levelOn[el.dataset.level] = el.checked;
			});
			// The level boxes cover 50 / 75 / 90%; other's lower lines go with "Other".
			const shown = layers.filter((d) => termOn[d.term] && (isMinor(d.level) || levelOn[d.level]));
			// Bands at 50%+ for every term, "other" included; other's lower
			// levels get dots instead.
			bands.selectAll("path").data(shown.filter((d) => !isMinor(d.level))).join("path")
				.attr("class", "iso-band")
				.attr("fill", (d) => FILL[d.term])
				.attr("fill-opacity", BAND_OPACITY)
				.attr("d", (d) => d.d);
			dots.selectAll("path").data(shown.filter((d) => isMinor(d.level))).join("path")
				.attr("fill", (d) => `url(#other-dots-${OTHER_MINOR_LEVELS.indexOf(d.level)})`)
				.attr("d", (d) => d.d);
			lines.selectAll("path").data(shown).join("path")
				.attr("class", "iso-line")
				.attr("stroke", (d) => LINE[d.term])
				.attr("stroke-width", (d) => (d.term === "other" ? OTHER_LINE_WIDTH : LINE_WIDTH)[d.level])
				.attr("d", (d) => d.d);
		}
		keyBoxes.forEach((el) => el.addEventListener("change", render));
		const contours = d3.contours().thresholds(LEVELS);
		const otherContours = d3.contours().thresholds(OTHER_LEVELS);

		function redraw() {
			const t0 = performance.now();
			const method = currentMethod();
			const radiusKm = +radiusInput.value * KM_PER_MILE;
			const minN = +minInput.value;

			grid = method === "adaptive" ? adaptive(minN, radiusKm) : splat(radiusKm, method === "gaussian");
			const threshold = method === "adaptive" ? 1 : minN; // adaptive cells are either full or empty

			const n = grid.w * grid.h;
			grid.other = new Float32Array(n);
			for (let i = 0; i < n; i++) grid.other[i] = Math.max(0, grid.total[i] - grid.pop[i] - grid.soda[i] - grid.coke[i]);
			const shares = new Float64Array(n);
			layers = [];
			contours.size([grid.w, grid.h]);
			otherContours.size([grid.w, grid.h]);
			const gridPath = d3.geoPath(d3.geoIdentity().scale(grid.step));
			for (const term of TERMS) {
				const g = grid[term];
				for (let i = 0; i < n; i++) {
					const t = grid.total[i];
					shares[i] = t >= threshold ? g[i] / t : -1; // too few responses: below every level
				}
				for (const c of (term === "other" ? otherContours : contours)(shares)) {
					if (c.coordinates.length) layers.push({ term, level: c.value, d: gridPath(c) });
				}
			}
			render();

			const ms = Math.round(performance.now() - t0);
			let summary;
			if (method === "adaptive") {
				const radii = Array.from(grid.radiusKm).filter((r) => r > 0).sort((a, b) => a - b);
				const median = radii.length ? radii[radii.length >> 1] / KM_PER_MILE : 0;
				summary = `Windows of ${fmt(minN)}+ responses; median radius ${Math.round(median)} miles`;
			} else {
				summary = `${method === "gaussian" ? "Gaussian σ" : "Window"} ${Math.round(radiusKm)} km, ` +
					`grid ${grid.step} px (~${Math.round(grid.step * medianKmPerPx)} km)`;
			}
			status.textContent = `${summary}; ${fmt(points.length)} ZIP codes and FSAs; computed in ${fmt(ms)} ms. ` +
				"Hover for the counts inside the window.";
		}

		applyMethodRanges(currentMethod(), false);
		// Values from the URL were capped by the sliders' original ranges;
		// set them again now that the ranges fit the method.
		const params = new URLSearchParams(location.search);
		if (params.has("radius")) radiusInput.value = params.get("radius");
		if (params.has("min-n")) minInput.value = params.get("min-n");
		updateLabels();
		radiusInput.addEventListener("input", updateLabels);
		minInput.addEventListener("input", updateLabels);
		radiusInput.addEventListener("change", redraw);
		minInput.addEventListener("change", redraw);
		methodInputs.forEach((el) => el.addEventListener("change", () => {
			applyMethodRanges(currentMethod(), true);
			updateLabels();
			redraw();
		}));

		svg.on("pointermove", (event) => {
			if (!grid) return;
			const [x, y] = d3.pointer(event, svg.node());
			const i = Math.floor(x / grid.step), j = Math.floor(y / grid.step);
			if (i < 0 || j < 0 || i >= grid.w || j >= grid.h) return tooltip.hide();
			const k = j * grid.w + i;
			const total = grid.total[k];
			if (!total) return tooltip.hide();
			const counts = { pop: grid.pop[k], soda: grid.soda[k], coke: grid.coke[k] };
			counts.other = total - counts.pop - counts.soda - counts.coke;
			const method = currentMethod();
			let title;
			if (method === "adaptive") {
				title = `Nearest ${fmt(Math.round(total))} responses (within ${Math.round(grid.radiusKm[k] / KM_PER_MILE)} miles)`;
			} else if (method === "gaussian") {
				title = `Distance-weighted responses (σ ${radiusInput.value} miles)`;
				for (const t of Object.keys(counts)) counts[t] = Math.round(counts[t] * 10) / 10;
			} else {
				title = `Within ${radiusInput.value} miles of here`;
			}
			tooltip.show(event, breakdownHTML(title, counts, Math.round(total * 10) / 10));
		});
		svg.on("pointerleave", () => tooltip.hide());

		redraw();
	}).catch((err) => {
		status.textContent = "Couldn't load data: " + err.message;
		throw err;
	});
})();
