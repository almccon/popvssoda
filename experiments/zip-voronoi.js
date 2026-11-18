// Voronoi cells around each ZIP code / FSA point, colored with the main map's
// CMY mix. The points are split into regions (countries, or states and
// provinces); each region gets its own Voronoi diagram clipped to its own
// outline, and the regions are drawn side by side, so cells never cross a
// region boundary.
(function () {
	"use strict";

	const { TERMS, fmt, breakdownHTML, makeTooltip } = window.PVS;
	const WIDTH = 960;
	const HEIGHT = 700;
	const NA_IDS = { US: "840", CA: "124" }; // world-atlas (Natural Earth) country ids

	// Same mix as the main map's "cmy" palette (js/map.js): each main term
	// adds to two RGB channels, so any "other" share darkens the cell.
	const mix = (p) => {
		const c = (v) => Math.round(Math.min(1, v) * 255);
		return `rgb(${c(p.pop + p.coke)},${c(p.soda + p.pop)},${c(p.coke + p.soda)})`;
	};

	const canvas = document.getElementById("canvas");
	const chart = document.getElementById("chart");
	const status = document.getElementById("status");
	const slider = document.getElementById("min-n");
	const sliderLabel = document.getElementById("min-n-label");
	const modeInputs = document.querySelectorAll("input[name=partition]");
	const tooltip = makeTooltip(chart);

	const dpr = window.devicePixelRatio || 1;
	canvas.width = WIDTH * dpr;
	canvas.height = HEIGHT * dpr;
	const ctx = canvas.getContext("2d");
	ctx.scale(dpr, dpr);

	Promise.all([
		d3.json("../vendor/world-atlas-2.0.2-countries-50m.json"),
		d3.json("../vendor/naturalearth-5.1.2-admin1-50m-us-canada.geojson"),
		d3.json("../vendor/naturalearth-5.1.2-lakes-50m-north-america.geojson"),
		d3.csv("../data/postal_counts.csv"),
	]).then(([world, admin1, lakes, rows]) => {
		const naGeoms = world.objects.countries.geometries.filter((g) => Object.values(NA_IDS).includes(g.id));
		const land = topojson.merge(world, naGeoms);
		const borders = topojson.mesh(world, { type: "GeometryCollection", geometries: naGeoms }, (a, b) => a !== b);

		// The contiguous US, southern Canada and Alaska, with Hawaii moved in
		// close to the mainland (see common.js). The territories are left out.
		const { projection } = window.PVS.northAmericaProjection(WIDTH, HEIGHT);
		const path = d3.geoPath(projection, ctx);

		const points = [];
		for (const r of rows) {
			if (!r.lat) continue;
			const xy = projection([+r.lon, +r.lat]);
			if (!xy || xy[0] < 0 || xy[0] > WIDTH || xy[1] < 0 || xy[1] > HEIGHT) continue;
			const counts = {};
			for (const t of TERMS) counts[t] = +r[t];
			const total = +r.total;
			const shares = {};
			for (const t of TERMS) shares[t] = counts[t] / total;
			points.push({
				x: xy[0], y: xy[1], lonLat: [+r.lon, +r.lat], country: r.country, state: r.state, counts, total,
				fill: mix(shares),
				title: `${r.country === "US" ? "ZIP" : "FSA"} ${r.postal_code}, ${r.state}`,
			});
		}

		// Region sets. A point belongs to the region whose key matches its
		// country (or state/province), whatever side of the line its centroid
		// happens to fall on.
		const partitions = {
			country: Object.entries(NA_IDS).map(([key, id]) => ({
				key,
				shape: topojson.feature(world, naGeoms.find((g) => g.id === id)),
				points: points.filter((p) => p.country === key),
			})),
			state: admin1.features.map((f) => ({
				key: f.properties.postal,
				shape: f,
				points: points.filter((p) => p.state === f.properties.postal),
			})),
		};

		// Hover lookup: an offscreen canvas with each region painted in a color
		// that encodes its index, so finding the region under the pointer is
		// a single pixel read.
		const hitMaps = {};
		for (const [mode, regions] of Object.entries(partitions)) {
			const hit = document.createElement("canvas");
			hit.width = WIDTH;
			hit.height = HEIGHT;
			const hctx = hit.getContext("2d", { willReadFrequently: true });
			const hpath = d3.geoPath(projection, hctx);
			regions.forEach((region, i) => {
				const n = i + 1;
				hctx.fillStyle = `rgb(${n & 255},${(n >> 8) & 255},0)`;
				hctx.beginPath();
				hpath(region.shape);
				hctx.fill();
			});
			hctx.fillStyle = "#000"; // lakes aren't land
			hctx.beginPath();
			hpath(lakes);
			hctx.fill();
			// Decode to region numbers. Anti-aliased edge pixels blend two colors
			// into the number of some unrelated region, so only trust a pixel whose
			// four neighbours decode to the same region; edges become 0 (none).
			const rgba = hctx.getImageData(0, 0, WIDTH, HEIGHT).data;
			const raw = new Uint16Array(WIDTH * HEIGHT);
			for (let i = 0; i < raw.length; i++) {
				raw[i] = rgba[i * 4 + 3] === 255 ? rgba[i * 4] + (rgba[i * 4 + 1] << 8) : 0;
			}
			const ids = new Uint16Array(WIDTH * HEIGHT);
			for (let y = 1; y < HEIGHT - 1; y++) {
				for (let x = 1; x < WIDTH - 1; x++) {
					const i = y * WIDTH + x, n = raw[i];
					if (n && raw[i - 1] === n && raw[i + 1] === n && raw[i - WIDTH] === n && raw[i + WIDTH] === n) ids[i] = n;
				}
			}
			hitMaps[mode] = ids;
		}
		const regionAt = (mode, x, y) => {
			const xi = Math.floor(x), yi = Math.floor(y);
			if (xi < 0 || yi < 0 || xi >= WIDTH || yi >= HEIGHT) return null;
			const n = hitMaps[mode][yi * WIDTH + xi];
			return n ? partitions[mode][n - 1] : null;
		};

		const currentMode = () => [...modeInputs].find((el) => el.checked).value;

		const EARTH_KM = 6371;
		const kmBetween = (a, b) => d3.geoDistance(a, b) * EARTH_KM;

		// Lower-48 land pixels (from the state hit map), used to measure the reach cap.
		const LOWER48_EXCLUDE = new Set(["AK", "HI"]);
		const lower48Pixels = [];
		{
			const data = hitMaps.state;
			for (let y = 0; y < HEIGHT; y++) {
				for (let x = 0; x < WIDTH; x++) {
					const n = data[y * WIDTH + x];
					const region = n && partitions.state[n - 1];
					if (region && region.points[0]?.country === "US" && !LOWER48_EXCLUDE.has(region.key)) {
						lower48Pixels.push(x + 0.5, y + 0.5);
					}
				}
			}
		}

		// The reach cap: the farthest any lower-48 land pixel is from the point
		// whose cell it falls in, for the current mode and slider setting. Cells
		// in Alaska and northern Canada are cut off at this distance, so color
		// never reaches further from a data point than it does anywhere in the
		// lower 48.
		function reachCapKm(mode) {
			let max = 0;
			let hint = 0;
			reachCapKm.lastRegion = null; // triangulations were just rebuilt
			for (let k = 0; k < lower48Pixels.length; k += 2) {
				const x = lower48Pixels[k], y = lower48Pixels[k + 1];
				const region = regionAt(mode, x, y);
				if (!region || !region.delaunay) continue;
				hint = region.delaunay.find(x, y, region === reachCapKm.lastRegion ? hint : 0);
				reachCapKm.lastRegion = region;
				const d = kmBetween(projection.invert([x, y]), region.shown[hint].lonLat);
				if (d > max) max = d;
			}
			return max;
		}

		function draw() {
			const minN = +slider.value;
			const mode = currentMode();
			sliderLabel.textContent = `${minN} response${minN === 1 ? "" : "s"}`;

			ctx.clearRect(0, 0, WIDTH, HEIGHT);
			ctx.fillStyle = "#fff";
			ctx.fillRect(0, 0, WIDTH, HEIGHT);

			let cells = 0, responses = 0, merged = 0;
			for (const region of partitions[mode]) {
				region.shown = region.points.filter((p) => p.total >= minN);
				merged += region.points.length - region.shown.length;
				region.delaunay = region.shown.length
					? d3.Delaunay.from(region.shown, (p) => p.x, (p) => p.y) : null;
			}
			capKm = reachCapKm(mode);
			const capCircle = d3.geoCircle().radius((capKm / EARTH_KM) * (180 / Math.PI));

			for (const region of partitions[mode]) {
				if (!region.delaunay) continue;
				const voronoi = region.delaunay.voronoi([0, 0, WIDTH, HEIGHT]);

				ctx.save();
				ctx.beginPath();
				path(region.shape);
				ctx.clip();
				for (let i = 0; i < region.shown.length; i++) {
					const p = region.shown[i];
					// Only cells with a corner beyond the cap need the extra circular clip.
					const poly = voronoi.cellPolygon(i);
					const capped = poly && poly.some((v) => kmBetween(projection.invert(v), p.lonLat) > capKm);
					if (capped) {
						ctx.save();
						ctx.beginPath();
						path(capCircle.center(p.lonLat)());
						ctx.clip();
					}
					ctx.beginPath();
					voronoi.renderCell(i, ctx);
					ctx.fillStyle = p.fill;
					ctx.fill();
					// Stroke in the same color to hide hairline gaps between cells.
					ctx.strokeStyle = p.fill;
					ctx.lineWidth = 0.5;
					ctx.stroke();
					if (capped) ctx.restore();
					cells++;
					responses += p.total;
				}
				ctx.restore();
			}

			// The country outlines include the Great Lakes etc.; paint them back out.
			ctx.beginPath();
			path(lakes);
			ctx.fillStyle = "#fff";
			ctx.fill();
			ctx.lineWidth = 0.5;
			ctx.strokeStyle = "#999";
			ctx.stroke();

			ctx.lineWidth = 0.5;
			ctx.strokeStyle = "rgba(255,255,255,0.75)";
			ctx.beginPath();
			path(admin1);
			ctx.stroke();

			ctx.lineWidth = 1;
			ctx.strokeStyle = "rgba(255,255,255,0.9)";
			ctx.beginPath();
			path(borders);
			ctx.stroke();

			ctx.lineWidth = 0.75;
			ctx.strokeStyle = "#999";
			ctx.beginPath();
			path(land);
			ctx.stroke();

			status.textContent = `${fmt(cells)} cells, ${fmt(responses)} responses` +
				(minN > 1 ? ` (${fmt(merged)} smaller cells merged into neighbours)` : "") +
				`. Cells reach at most ${fmt(Math.round(capKm))} km from their point, ` +
				"the farthest any cell reaches in the lower 48 at this setting.";
		}

		let capKm = Infinity;
		slider.addEventListener("input", draw);
		modeInputs.forEach((el) => el.addEventListener("change", draw));

		canvas.addEventListener("pointermove", (event) => {
			const box = canvas.getBoundingClientRect();
			const x = (event.clientX - box.left) * (WIDTH / box.width);
			const y = (event.clientY - box.top) * (HEIGHT / box.height);
			const region = regionAt(currentMode(), x, y);
			if (!region || !region.delaunay) return tooltip.hide();
			const p = region.shown[region.delaunay.find(x, y)];
			if (kmBetween(projection.invert([x, y]), p.lonLat) > capKm) return tooltip.hide();
			tooltip.show(event, breakdownHTML(p.title, p.counts, p.total));
		});
		canvas.addEventListener("pointerleave", () => tooltip.hide());

		draw();
	}).catch((err) => {
		status.textContent = "Couldn't load data: " + err.message;
		throw err;
	});
})();
