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

		// Frame where the responses are: the contiguous US, southern Canada and
		// Alaska. Fit to a few corner points rather than the land so the Arctic
		// islands don't dominate. Hawaii and the territories are left out.
		const projection = d3.geoConicConformal()
			.rotate([100, 0]).parallels([30, 60])
			.fitExtent([[8, 8], [WIDTH - 8, HEIGHT - 8]], {
				type: "MultiPoint",
				coordinates: [[-162, 58], [-156.8, 71.3], [-52.6, 47.5], [-80.5, 24.5], [-97.2, 25.8],
					[-117, 32.5], [-124.7, 48.4], [-95, 62]],
			});
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
				x: xy[0], y: xy[1], country: r.country, state: r.state, counts, total,
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
			hitMaps[mode] = hctx.getImageData(0, 0, WIDTH, HEIGHT).data;
		}
		const regionAt = (mode, x, y) => {
			const xi = Math.floor(x), yi = Math.floor(y);
			if (xi < 0 || yi < 0 || xi >= WIDTH || yi >= HEIGHT) return null;
			const o = (yi * WIDTH + xi) * 4;
			const n = hitMaps[mode][o] + (hitMaps[mode][o + 1] << 8);
			return n ? partitions[mode][n - 1] : null;
		};

		const currentMode = () => [...modeInputs].find((el) => el.checked).value;

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
				region.delaunay = null;
				if (!region.shown.length) continue;
				region.delaunay = d3.Delaunay.from(region.shown, (p) => p.x, (p) => p.y);
				const voronoi = region.delaunay.voronoi([0, 0, WIDTH, HEIGHT]);

				ctx.save();
				ctx.beginPath();
				path(region.shape);
				ctx.clip();
				for (let i = 0; i < region.shown.length; i++) {
					const p = region.shown[i];
					ctx.beginPath();
					voronoi.renderCell(i, ctx);
					ctx.fillStyle = p.fill;
					ctx.fill();
					// Stroke in the same color to hide hairline gaps between cells.
					ctx.strokeStyle = p.fill;
					ctx.lineWidth = 0.5;
					ctx.stroke();
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
				(minN > 1 ? ` (${fmt(merged)} smaller cells merged into neighbours)` : "");
		}

		slider.addEventListener("input", draw);
		modeInputs.forEach((el) => el.addEventListener("change", draw));

		canvas.addEventListener("pointermove", (event) => {
			const box = canvas.getBoundingClientRect();
			const x = (event.clientX - box.left) * (WIDTH / box.width);
			const y = (event.clientY - box.top) * (HEIGHT / box.height);
			const region = regionAt(currentMode(), x, y);
			if (!region || !region.delaunay) return tooltip.hide();
			const p = region.shown[region.delaunay.find(x, y)];
			tooltip.show(event, breakdownHTML(p.title, p.counts, p.total));
		});
		canvas.addEventListener("pointerleave", () => tooltip.hide());

		draw();
	}).catch((err) => {
		status.textContent = "Couldn't load data: " + err.message;
		throw err;
	});
})();
