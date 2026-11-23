// ZIP circles: one circle per US ZIP code or Canadian FSA, at its point, with
// area proportional to its number of responses and colored with the main
// map's CMY mix. No layout: circles overlap freely. They're drawn biggest
// first, so small places stay visible on top of their big neighbours.

(function () {
	"use strict";

	const { TERMS, fmt, breakdownHTML, makeTooltip, northAmericaProjection, mixCounts, drawBasemap } = PVS;
	const { width: WIDTH, height: HEIGHT } = PVS.FRAME;

	const canvas = document.getElementById("canvas");
	const ctx = canvas.getContext("2d");
	const statusEl = document.getElementById("status");
	const slider = document.getElementById("size");
	const sliderValue = document.getElementById("size-value");
	const opacityInput = document.getElementById("opacity");
	const opacityValue = document.getElementById("opacity-value");
	const tooltip = makeTooltip(document.getElementById("chart"));
	PVS.showMixKey(document.getElementById("chart"));
	PVS.addCredit(document.getElementById("chart"));

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
		const path = d3.geoPath(projection);
		const landPath = new Path2D(path(topojson.merge(world, naGeoms)));
		const adminPath = new Path2D(path(admin1));
		const lakePath = new Path2D(path(lakes));

		const circles = [];
		for (const r of rows) {
			if (!r.lat || !+r.total) continue;
			const xy = projection([+r.lon, +r.lat]);
			if (!xy || xy[0] < 0 || xy[0] > WIDTH || xy[1] < 0 || xy[1] > HEIGHT) continue;
			const counts = {};
			for (const t of TERMS) counts[t] = +r[t];
			circles.push({
				x: xy[0], y: xy[1], counts, total: +r.total,
				fill: mixCounts(counts, +r.total),
				title: `${r.country === "US" ? "ZIP code" : "FSA"} ${r.postal_code}, ${r.state}`,
			});
		}
		circles.sort((a, b) => b.total - a.total); // biggest drawn first
		const totalResponses = d3.sum(circles, (c) => c.total);

		let scale = +slider.value; // px of radius per sqrt(response)
		let hovered = null;

		function draw() {
			ctx.clearRect(0, 0, WIDTH, HEIGHT);
			drawBasemap(ctx, { land: landPath, lakes: lakePath, admin: adminPath });

			ctx.globalAlpha = +opacityInput.value * (hovered ? 0.4 : 1);
			ctx.lineWidth = 0.5;
			ctx.strokeStyle = "rgba(0,0,0,0.45)";
			for (const c of circles) {
				const r = scale * Math.sqrt(c.total);
				ctx.beginPath();
				ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
				ctx.fillStyle = c.fill;
				ctx.fill();
				// Outlines only where they help: tiny circles would be all outline.
				if (r > 1.5) ctx.stroke();
			}
			ctx.globalAlpha = 1;

			if (hovered) {
				ctx.beginPath();
				ctx.arc(hovered.x, hovered.y, Math.max(scale * Math.sqrt(hovered.total), 2), 0, 2 * Math.PI);
				ctx.fillStyle = hovered.fill;
				ctx.fill();
				ctx.lineWidth = 1.5;
				ctx.strokeStyle = "#222";
				ctx.stroke();
			}
		}

		function updateKeys() {
			sliderValue.textContent = scale.toFixed(2);
			opacityValue.textContent = Math.round(+opacityInput.value * 100) + "%";
			const sizes = [10, 100, 500];
			const big = scale * Math.sqrt(sizes[sizes.length - 1]);
			const key = d3.select("#size-key").html("");
			const svg = key.append("svg").attr("width", big * 2 + 40).attr("height", big * 2 + 4);
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

		// The topmost circle under the pointer: circles are drawn biggest first,
		// so search smallest first. Tiny circles get a little slack.
		const quadtree = d3.quadtree(circles, (c) => c.x, (c) => c.y);
		function circleAt(event) {
			const rect = canvas.getBoundingClientRect();
			const x = ((event.clientX - rect.left) * WIDTH) / rect.width;
			const y = ((event.clientY - rect.top) * HEIGHT) / rect.height;
			const maxR = scale * Math.sqrt(circles[0].total);
			let best = null;
			quadtree.visit((node, x0, y0, x1, y1) => {
				if (!node.length) {
					do {
						const c = node.data;
						const reach = Math.max(scale * Math.sqrt(c.total), 3);
						if (Math.hypot(c.x - x, c.y - y) <= reach && (!best || c.total < best.total)) best = c;
					} while ((node = node.next));
				}
				return x0 > x + maxR || x1 < x - maxR || y0 > y + maxR || y1 < y - maxR;
			});
			return best;
		}

		function setHover(event) {
			const c = circleAt(event);
			if (c !== hovered) {
				hovered = c;
				draw();
			}
			if (c) tooltip.show(event, breakdownHTML(c.title, c.counts, c.total));
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
			updateKeys();
			draw();
		});
		opacityInput.addEventListener("input", () => {
			updateKeys();
			draw();
		});

		updateKeys();
		draw();
		statusEl.textContent = `${fmt(circles.length)} circles for ${fmt(totalResponses)} responses. ` +
			"Hover over (or tap) a circle for its ZIP code or FSA.";
	}).catch((err) => {
		statusEl.textContent = "Couldn't load data: " + err.message;
		throw err;
	});
})();
