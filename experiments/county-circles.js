// County circles: four circles per county (pop / soda / coke / other), area
// proportional to the number of responses, spread apart with a force layout.
// Drawn on canvas: there are ~9,000 circles and they move while settling.

(function () {
	"use strict";

	const { TERMS, COLOR, fmt, loadData, breakdownHTML, makeTooltip, colorKeyHTML } = PVS;
	const WIDTH = 960, HEIGHT = 600;
	const PADDING = 0.4; // px between touching circles

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
	document.getElementById("color-key").innerHTML = colorKeyHTML("disc");

	function sizeCanvas() {
		const dpr = window.devicePixelRatio || 1;
		canvas.width = WIDTH * dpr;
		canvas.height = HEIGHT * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}
	sizeCanvas();

	loadData("../").then((data) => {
		const projection = d3.geoAlbersUsa().fitExtent([[10, 10], [WIDTH - 10, HEIGHT - 10]], data.land);
		const path = d3.geoPath(projection);
		const landPath = new Path2D(path(data.land));
		const statePath = new Path2D(path(data.stateMesh));

		const featureById = new Map(data.countyFeatures.map((f) => [+f.id, f]));

		// One node per (county, term) with at least one response.
		const nodes = [];
		for (const c of data.counties) {
			const f = featureById.get(c.id);
			if (!f) continue;
			const [hx, hy] = path.centroid(f);
			if (!isFinite(hx)) continue;
			for (const t of TERMS) {
				if (c.counts[t] > 0) nodes.push({ county: c, term: t, n: c.counts[t], homeX: hx, homeY: hy });
			}
		}

		let scale = +slider.value; // px of radius per sqrt(response)
		let hovered = null;        // county record under the pointer

		function draw() {
			ctx.clearRect(0, 0, WIDTH, HEIGHT);
			ctx.fillStyle = "#f7f7f7";
			ctx.fill(landPath);
			ctx.strokeStyle = "#d6d6d6";
			ctx.lineWidth = 1;
			ctx.stroke(landPath);
			ctx.strokeStyle = "#ddd";
			ctx.lineWidth = 0.75;
			ctx.stroke(statePath);

			// Batch circles by color: far fewer state changes than per-circle.
			for (const t of TERMS) {
				ctx.beginPath();
				for (const d of nodes) {
					if (d.term !== t) continue;
					ctx.moveTo(d.x + d.r, d.y);
					ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
				}
				ctx.globalAlpha = hovered ? 0.35 : 1;
				ctx.fillStyle = COLOR[t];
				ctx.fill();
			}
			ctx.globalAlpha = 1;

			if (hovered) {
				for (const d of nodes) {
					if (d.county !== hovered) continue;
					ctx.beginPath();
					ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
					ctx.fillStyle = COLOR[d.term];
					ctx.fill();
					ctx.lineWidth = 1.5;
					ctx.strokeStyle = "#222";
					ctx.stroke();
				}
			}
		}

		const simulation = d3.forceSimulation()
			.force("x", d3.forceX((d) => d.homeX).strength(0.08))
			.force("y", d3.forceY((d) => d.homeY).strength(0.08))
			.force("collide", d3.forceCollide((d) => d.r + PADDING).iterations(2))
			.alphaDecay(0.03)
			.on("tick", () => {
				draw();
				statusEl.textContent = `Settling… ${Math.round((1 - simulation.alpha()) * 100)}%`;
			})
			.on("end", () => {
				statusEl.textContent = `${fmt(nodes.length)} circles for ${fmt(d3.sum(nodes, (d) => d.n))} responses. ` +
					"Hover over (or tap) a circle for its county.";
			});

		function start() {
			for (const d of nodes) {
				d.r = scale * Math.sqrt(d.n);
				const [ox, oy] = START_OFFSET[d.term];
				d.x = d.homeX + ox;
				d.y = d.homeY + oy;
				d.vx = d.vy = 0;
			}
			simulation.nodes(nodes);
			simulation.force("collide").radius((d) => d.r + PADDING); // re-read radii
			simulation.alpha(1).restart();
			updateSizeKey();
		}

		function updateSizeKey() {
			sliderValue.textContent = scale.toFixed(2);
			const sizes = [100, 1000, 5000];
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
			if (d) tooltip.show(event, breakdownHTML(county.name, county.counts, county.total, d.term));
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
		document.getElementById("replay").addEventListener("click", start);

		start();
	});
})();
