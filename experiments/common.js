// Shared helpers for the experimental Pop vs Soda views.
// Expects D3 v7 and topojson-client v3 to be loaded first.

window.PVS = (function () {
	"use strict";

	// Page settings from the URL, so the homepage can embed a page with chosen
	// defaults: ?embed=1 hides the navigation and intro, and any other key sets
	// the control with that name (radio buttons) or id (checkboxes take 1 or 0,
	// other inputs take the value). This runs before each page's own script.
	(function applyURLSettings() {
		const params = new URLSearchParams(location.search);
		if (params.get("embed") === "1") document.documentElement.classList.add("embed");
		for (const [key, value] of params) {
			if (key === "embed") continue;
			const radios = document.querySelectorAll(`input[type=radio][name="${CSS.escape(key)}"]`);
			if (radios.length) {
				for (const r of radios) r.checked = r.value === value;
				continue;
			}
			const el = document.getElementById(key);
			if (!el || el.tagName !== "INPUT") continue;
			if (el.type === "checkbox") el.checked = value === "1" || value === "true";
			else el.value = value;
		}
	})();

	const TERMS = ["pop", "soda", "coke", "other"];
	const LABEL = { pop: "Pop", soda: "Soda", coke: "Coke", other: "Other" };

	// Darker relatives of the main map's yellow / cyan / magenta, so small
	// marks stay visible on white. "Other" is a deliberately neutral gray,
	// matching the main map, where "other" darkens a county towards black.
	const COLOR = { pop: "#c49a00", soda: "#0a8fbf", coke: "#d13a8a", other: "#555555" };

	const STATE_ABBR = {
		"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
		"10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
		"18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
		"25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
		"32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
		"39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
		"47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
		"55": "WI", "56": "WY",
	};

	// Background layers shared by every map (the state donuts' look): the page
	// panel (#eee) shows through as the background field, land is a pale gray,
	// lakes are white. experiments.css has the same colors for SVG maps.
	const BASEMAP = {
		land: "#f7f7f7", landStroke: "#d6d6d6",
		lake: "#fff", lakeStroke: "#ddd",
		admin: "#ddd",
	};

	// Draw the background layers on a canvas. Each argument is a Path2D or
	// null: land (filled even-odd, so holes cut out by lakes stay open), lakes,
	// and state/province lines.
	function drawBasemap(ctx, { land, lakes, admin }) {
		if (land) { ctx.fillStyle = BASEMAP.land; ctx.fill(land, "evenodd"); }
		if (lakes) { ctx.fillStyle = BASEMAP.lake; ctx.fill(lakes); }
		ctx.lineWidth = 0.75;
		ctx.strokeStyle = BASEMAP.admin;
		if (admin) ctx.stroke(admin);
		ctx.lineWidth = 0.5;
		ctx.strokeStyle = BASEMAP.lakeStroke;
		if (lakes) ctx.stroke(lakes);
		ctx.lineWidth = 1;
		ctx.strokeStyle = BASEMAP.landStroke;
		if (land) ctx.stroke(land);
	}

	const fmt = d3.format(",");
	const pct = (v) => Math.round(v * 100) + "%";

	// The county shapes in d3/us.json predate some changes to county codes.
	// Responses with a newer code are counted in the older county covering it.
	// (js/map.js has the same table.)
	const OLD_FIPS = {
		2063: 2261, 2066: 2261,   // Chugach, Copper River → Valdez-Cordova
		2105: 2232, 2230: 2232,   // Hoonah-Angoon, Skagway → Skagway-Hoonah-Angoon
		2158: 2270,               // Kusilvak → Wade Hampton
		2195: 2280, 2275: 2280,   // Petersburg, Wrangell → Wrangell-Petersburg
		2198: 2201,               // Prince of Wales-Hyder → Prince of Wales-Outer Ketchikan
		46102: 46113,             // Oglala Lakota → Shannon
	};

	// Rows of data/county_counts.csv → one record per county shape:
	// { id, name, state (2-digit FIPS), counts: {pop,...}, total }
	function countyRecords(rows) {
		const byId = new Map();
		for (const r of rows) {
			const id = OLD_FIPS[+r.county_fips] || +r.county_fips;
			const counts = {};
			for (const t of TERMS) counts[t] = +r[t] || 0;
			const name = `${r.county_name}, ${STATE_ABBR[r.county_fips.slice(0, 2)] || ""}`;
			const prev = byId.get(id);
			if (prev) {
				prev.name = prev.name.replace(/, (\w+)$/, ` and ${name}`);
				for (const t of TERMS) prev.counts[t] += counts[t];
				prev.total += +r.total;
			} else {
				byId.set(id, { id, name, state: String(id).padStart(5, "0").slice(0, 2), counts, total: +r.total });
			}
		}
		return byId;
	}

	// Load boundaries and county data (records as from countyRecords).
	function loadData(base) {
		return Promise.all([
			d3.json(base + "d3/us.json"),
			d3.csv(base + "data/county_counts.csv"),
		]).then(([us, rows]) => {
			const counties = [...countyRecords(rows).values()];
			return {
				us,
				counties,
				land: topojson.feature(us, us.objects.land),
				countyFeatures: topojson.feature(us, us.objects.counties).features,
				stateFeatures: topojson.feature(us, us.objects.states).features,
				stateMesh: topojson.mesh(us, us.objects.states, (a, b) => a !== b),
			};
		});
	}

	function breakdownHTML(title, counts, total, highlight) {
		const rows = TERMS.map((t) =>
			`<tr${t === highlight ? ' class="hl"' : ""}>` +
			`<td><span class="dot" style="background:${COLOR[t]}"></span>${LABEL[t]}</td>` +
			`<td class="num">${fmt(counts[t])}</td>` +
			`<td class="num">${total ? pct(counts[t] / total) : "–"}</td></tr>`
		).join("");
		return `<strong>${title}</strong>` +
			`<div class="n">${fmt(total)} response${total === 1 ? "" : "s"}</div>` +
			`<table>${rows}</table>`;
	}

	// Tooltip positioned inside `container` next to the pointer.
	function makeTooltip(container) {
		const el = document.createElement("div");
		el.className = "tooltip";
		el.hidden = true;
		container.appendChild(el);
		return {
			show(event, html) {
				el.innerHTML = html;
				el.hidden = false;
				const box = container.getBoundingClientRect();
				const tip = el.getBoundingClientRect();
				let x = event.clientX - box.left + 14;
				let y = event.clientY - box.top + 14;
				if (x + tip.width > box.width) x = event.clientX - box.left - tip.width - 14;
				if (y + tip.height > box.height) y = event.clientY - box.top - tip.height - 14;
				el.style.left = Math.max(0, x) + "px";
				el.style.top = Math.max(0, y) + "px";
			},
			hide() { el.hidden = true; },
		};
	}

	// Projection for the maps that show the US and Canada together: a conic
	// conformal framed on the contiguous US, southern Canada and Alaska, with
	// Hawaii moved into the empty Pacific southwest of California. Hawaii keeps
	// the same scale as the mainland; it's only shifted. Like d3.geoAlbersUsa,
	// it's a composite: points and inverses go to whichever part they belong
	// to, and paths are drawn through both, each part clipped to its own area.
	//
	// Returns the projection plus `inInsetPx(x, y)` and `inInsetLonLat(lon, lat)`,
	// which say whether a pixel or a location belongs to the Hawaii inset.
	function northAmericaProjection(width, height) {
		const main = d3.geoConicConformal()
			.rotate([100, 0]).parallels([30, 60])
			.fitExtent([[8, 8], [width - 8, height - 8]], {
				type: "MultiPoint",
				coordinates: [[-162, 58], [-156.8, 71.3], [-52.6, 47.5], [-80.5, 24.5], [-97.2, 25.8],
					[-117, 32.5], [-124.7, 48.4], [-95, 62]],
			});

		const HAWAII = [[-161, 18.5], [-154.5, 22.5]]; // lon/lat box around the islands
		const HAWAII_CENTER = [-157.3, 20.4];
		const HAWAII_AT = [-127, 27.5]; // where its center goes on the main map
		const hawaii = d3.geoConicConformal()
			.rotate([157, 0]).parallels([30, 60]).scale(main.scale()).translate(main.translate());
		const [hx, hy] = hawaii(HAWAII_CENTER);
		const [tx, ty] = main(HAWAII_AT);
		const [ox, oy] = hawaii.translate();
		hawaii.translate([ox + tx - hx, oy + ty - hy]);
		// Pixel box for the inset: the islands' extent plus a margin.
		const corners = [HAWAII[0], HAWAII[1], [HAWAII[0][0], HAWAII[1][1]], [HAWAII[1][0], HAWAII[0][1]]].map(hawaii);
		const pad = 12;
		const box = [
			[d3.min(corners, (c) => c[0]) - pad, d3.min(corners, (c) => c[1]) - pad],
			[d3.max(corners, (c) => c[0]) + pad, d3.max(corners, (c) => c[1]) + pad],
		];
		hawaii.clipExtent(box);

		const inInsetLonLat = (lon, lat) =>
			lon >= HAWAII[0][0] && lon <= HAWAII[1][0] && lat >= HAWAII[0][1] && lat <= HAWAII[1][1];
		const inInsetPx = (x, y) => x >= box[0][0] && x <= box[1][0] && y >= box[0][1] && y <= box[1][1];

		const projection = ([lon, lat]) => (inInsetLonLat(lon, lat) ? hawaii : main)([lon, lat]);
		projection.invert = ([x, y]) => (inInsetPx(x, y) ? hawaii : main).invert([x, y]);
		projection.stream = (out) => {
			// The real Hawaii lies off the main frame, so the main part only
			// needs clipping to the canvas.
			const streams = [main.stream(out), hawaii.stream(out)];
			const each = (fn) => (...args) => streams.forEach((st) => st[fn](...args));
			return {
				point: each("point"), sphere: each("sphere"), lineStart: each("lineStart"),
				lineEnd: each("lineEnd"), polygonStart: each("polygonStart"), polygonEnd: each("polygonEnd"),
			};
		};
		projection.insetBox = box;
		return { projection, inInsetPx, inInsetLonLat };
	}

	// The main map's "cmy" mix (js/map.js) for a set of shares {pop, soda,
	// coke, other}: each main term adds to two RGB channels (pop yellow, soda
	// cyan, coke magenta), so any "other" share darkens the color.
	const mix = (p) => {
		const c = (v) => Math.round(Math.min(1, v) * 255);
		return `rgb(${c(p.pop + p.coke)},${c(p.soda + p.pop)},${c(p.coke + p.soda)})`;
	};
	const mixCounts = (counts, total) => {
		const shares = {};
		for (const t of TERMS) shares[t] = total ? counts[t] / total : 0;
		return mix(shares);
	};

	// Key for the mixed colors: the three pure colors, two blends, and "other".
	function mixKeyHTML() {
		const item = (shares, label) =>
			`<span class="key-item"><span class="disc" style="background:${mix({ pop: 0, soda: 0, coke: 0, other: 0, ...shares })};` +
			`box-shadow:inset 0 0 0 1px rgba(0,0,0,0.3)"></span>${label}</span>`;
		return item({ pop: 1 }, "Pop") + item({ soda: 1 }, "Soda") + item({ coke: 1 }, "Coke") +
			item({ pop: 0.5, soda: 0.5 }, "Pop and soda") + item({ soda: 0.5, coke: 0.5 }, "Soda and coke") +
			item({ pop: 0.5, other: 0.5 }, "Darker: more \"other\"");
	}

	// Swelling state outlines for the bubble maps. Each state starts as its own
	// border. As the bubbles grow and push each other around, every corner of
	// the border moves by a weighted average of how far that state's nearest
	// bubbles have moved from home, so the border follows its bubbles; corners
	// far from any bubble stay put. The outline is the edge of that moved
	// border merged with the state's own bubbles (each padded by `pad` px), so
	// it always encloses them. Neighbouring bubbles of the same state less than
	// `link` px apart are joined by a bridge (the hull of the two circles), and
	// the gap between three joined bubbles is filled (from a Delaunay
	// triangulation), so a cluster of bubbles gets one outline, not one each.
	//
	// `shapes`: [{ key, feature }]; `projection`: the map's projection; `nodes`:
	// bubbles with { stateKey, homeX, homeY, x, y, r }; `size`: { width, height,
	// dpr } of the canvas. Returns { draw(ctx) }, which draws every state's
	// outline; call it before drawing the bubbles.
	function swellingOutlines(shapes, projection, nodes, size, opts = {}) {
		const { pad = 1.5, link = 12, k = 8, reach = 40, soften = 10, color = "#555", lineWidth = 1.2 } = opts;
		const { width, height, dpr } = size;
		const byState = d3.group(nodes, (d) => d.stateKey);
		const states = [];
		for (const { key, feature } of shapes) {
			const own = byState.get(key) || [];
			// Record the projected rings by drawing the path into a recorder.
			const rings = [];
			let ring = null;
			d3.geoPath(projection, {
				moveTo(x, y) { ring = [[x, y]]; rings.push(ring); },
				lineTo(x, y) { ring.push([x, y]); },
				closePath() {},
				arc() {},
			})(feature);
			// For each corner: its k nearest bubbles (by home position) and weights.
			const W0 = k / (reach * reach);
			const verts = rings.map((r) => r.map(([x, y]) => {
				const best = []; // [dist2, node], kept sorted, at most k long
				for (const d of own) {
					const dist2 = (d.homeX - x) ** 2 + (d.homeY - y) ** 2;
					if (best.length === k && dist2 >= best[k - 1][0]) continue;
					let i = Math.min(best.length, k - 1);
					while (i > 0 && best[i - 1][0] > dist2) { best[i] = best[i - 1]; i--; }
					best[i] = [dist2, d];
				}
				const near = best.map(([dist2, d]) => ({ d, w: 1 / (dist2 + soften * soften) }));
				return { x, y, near, wsum: W0 + d3.sum(near, (n) => n.w) };
			}));
			states.push({ key, verts, own });
		}

		// Two scratch canvases. For each state: A = border plus padded bubbles;
		// B = A shrunk by the line width; the outline is A minus B.
		const scratch = () => {
			const c = document.createElement("canvas");
			c.width = width * dpr;
			c.height = height * dpr;
			const x = c.getContext("2d");
			x.setTransform(dpr, 0, 0, dpr, 0, 0);
			return x;
		};
		const ringCtx = scratch(), innerCtx = scratch();

		// Each state's circles, bridges and triangles are each filled as one
		// path. Every shape in a path is traced in the same direction, so with
		// the nonzero rule overlaps add up rather than cancel.
		function fillCircles(c, list, grow) {
			c.beginPath();
			for (const d of list) {
				const r = d.r + grow;
				if (!(r > 0)) continue;
				c.moveTo(d.x + r, d.y);
				c.arc(d.x, d.y, r, 0, 2 * Math.PI);
			}
			c.fill();
		}
		// The hull of two circles (between their outer tangent lines).
		function fillBridges(c, list, grow) {
			c.beginPath();
			for (const [a, b] of list) {
				const ra = Math.max(0, a.r + grow), rb = Math.max(0, b.r + grow);
				const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
				if (d <= Math.abs(ra - rb)) continue; // one circle inside the other
				const t = Math.atan2(dy, dx), f = Math.acos((ra - rb) / d);
				c.moveTo(a.x + ra * Math.cos(t + f), a.y + ra * Math.sin(t + f));
				c.lineTo(b.x + rb * Math.cos(t + f), b.y + rb * Math.sin(t + f));
				c.lineTo(b.x + rb * Math.cos(t - f), b.y + rb * Math.sin(t - f));
				c.lineTo(a.x + ra * Math.cos(t - f), a.y + ra * Math.sin(t - f));
				c.closePath();
			}
			c.fill();
		}

		function draw(ctx) {
			for (const s of states) {
				let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
				const border = new Path2D();
				for (const r of s.verts) {
					r.forEach((v, i) => {
						let dx = 0, dy = 0;
						for (const { d, w } of v.near) {
							dx += w * (d.x - d.homeX);
							dy += w * (d.y - d.homeY);
						}
						const x = v.x + dx / v.wsum, y = v.y + dy / v.wsum;
						if (x < x0) x0 = x; if (x > x1) x1 = x;
						if (y < y0) y0 = y; if (y > y1) y1 = y;
						if (i) border.lineTo(x, y); else border.moveTo(x, y);
					});
					border.closePath();
				}
				const live = s.own.filter((d) => d.r > 0);
				for (const d of live) {
					const R = d.r + pad;
					if (d.x - R < x0) x0 = d.x - R; if (d.x + R > x1) x1 = d.x + R;
					if (d.y - R < y0) y0 = d.y - R; if (d.y + R > y1) y1 = d.y + R;
				}
				if (!(x1 > x0)) continue;
				// Links between neighbouring bubbles, and triangles of three linked bubbles.
				const bridges = [], gaps = [];
				if (live.length >= 2) {
					const { triangles, halfedges } = d3.Delaunay.from(live, (d) => d.x, (d) => d.y);
					const other = (e) => live[triangles[e % 3 === 2 ? e - 2 : e + 1]];
					const dist = (e) => {
						const a = live[triangles[e]], b = other(e);
						return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r - 2 * pad;
					};
					const linked = (e) => dist(e) < link;
					for (let e = 0; e < triangles.length; e++) {
						if (halfedges[e] > e) continue; // each edge once
						// Bubbles whose padded circles already overlap need no bridge.
						const gap = dist(e);
						if (gap > 0 && gap < link) bridges.push([live[triangles[e]], other(e)]);
					}
					for (let t = 0; t < triangles.length; t += 3) {
						if (linked(t) && linked(t + 1) && linked(t + 2)) {
							gaps.push([live[triangles[t]], live[triangles[t + 1]], live[triangles[t + 2]]]);
						}
					}
				}
				// The triangles are the same for both passes: build them once.
				let gapPath = null;
				if (gaps.length) {
					gapPath = new Path2D();
					for (const [a, b, d] of gaps) {
						gapPath.moveTo(a.x, a.y);
						gapPath.lineTo(b.x, b.y);
						gapPath.lineTo(d.x, d.y);
						gapPath.closePath();
					}
				}
				const fillGaps = (c) => { if (gapPath) c.fill(gapPath); };
				// Work only inside the state's box (whole device pixels).
				const bx = Math.max(0, Math.floor(x0 - 2)), by = Math.max(0, Math.floor(y0 - 2));
				const bw = Math.min(width, Math.ceil(x1 + 2)) - bx, bh = Math.min(height, Math.ceil(y1 + 2)) - by;
				if (bw <= 0 || bh <= 0) continue;
				for (const c of [ringCtx, innerCtx]) {
					c.globalCompositeOperation = "source-over";
					c.clearRect(bx, by, bw, bh);
				}
				// B: the border shrunk by the line width, plus the shrunk bubbles.
				innerCtx.fillStyle = "#000";
				innerCtx.fill(border);
				innerCtx.globalCompositeOperation = "destination-out";
				innerCtx.lineWidth = lineWidth * 2;
				innerCtx.lineJoin = "round";
				innerCtx.stroke(border);
				innerCtx.globalCompositeOperation = "source-over";
				fillCircles(innerCtx, live, pad - lineWidth);
				fillBridges(innerCtx, bridges, pad - lineWidth);
				fillGaps(innerCtx);
				// A, then cut B out of it.
				ringCtx.fillStyle = color;
				ringCtx.fill(border);
				fillCircles(ringCtx, live, pad);
				fillBridges(ringCtx, bridges, pad);
				fillGaps(ringCtx);
				ringCtx.globalCompositeOperation = "destination-out";
				ringCtx.drawImage(innerCtx.canvas, bx * dpr, by * dpr, bw * dpr, bh * dpr, bx, by, bw, bh);
				ctx.drawImage(ringCtx.canvas, bx * dpr, by * dpr, bw * dpr, bh * dpr, bx, by, bw, bh);
			}
		}
		return { draw };
	}

	// A force that keeps bubbles from different states at least `gap` px
	// apart (on top of the usual collision force), so each state's outline
	// has room between its bubbles and its neighbours'.
	function separateStates(gap, strength = 0.7) {
		let nodes = [];
		// Like d3.forceCollide: each quadtree cell remembers its biggest
		// radius, so the search around a bubble skips cells too far to matter.
		const prepare = (quad) => {
			if (quad.data) { quad.r = quad.data.r; return; }
			quad.r = 0;
			for (let i = 0; i < 4; i++) if (quad[i] && quad[i].r > quad.r) quad.r = quad[i].r;
		};
		function force() {
			const tree = d3.quadtree(nodes, (d) => d.x + d.vx, (d) => d.y + d.vy).visitAfter(prepare);
			for (const a of nodes) {
				if (!(a.r > 0)) continue;
				const ax = a.x + a.vx, ay = a.y + a.vy;
				tree.visit((q, x0, y0, x1, y1) => {
					const reach = a.r + q.r + gap;
					if (!q.length) {
						do {
							const b = q.data;
							if (b.index > a.index && b.stateKey !== a.stateKey && b.r > 0) {
								let dx = ax - (b.x + b.vx), dy = ay - (b.y + b.vy);
								const min = a.r + b.r + gap;
								let d2 = dx * dx + dy * dy;
								if (d2 < min * min) {
									if (d2 === 0) { dx = 1e-3 * (a.index % 2 ? 1 : -1); dy = 1e-3; d2 = dx * dx + dy * dy; }
									const dist = Math.sqrt(d2);
									const l = ((min - dist) / dist) * strength;
									const wa = b.r * b.r / (a.r * a.r + b.r * b.r);
									a.vx += dx * l * wa; a.vy += dy * l * wa;
									b.vx -= dx * l * (1 - wa); b.vy -= dy * l * (1 - wa);
								}
							}
						} while ((q = q.next));
						return;
					}
					return x0 > ax + reach || x1 < ax - reach || y0 > ay + reach || y1 < ay - reach;
				});
			}
		}
		force.initialize = (n) => { nodes = n; };
		return force;
	}

	// Color key: one swatch + name per term.
	function colorKeyHTML(shape) {
		return TERMS.map((t) =>
			`<span class="key-item"><span class="${shape}" style="background:${COLOR[t]}"></span>${LABEL[t]}</span>`
		).join("");
	}

	return {
		TERMS, LABEL, COLOR, STATE_ABBR, BASEMAP, drawBasemap, fmt, pct, loadData, countyRecords, breakdownHTML, makeTooltip, colorKeyHTML,
		northAmericaProjection, mix, mixCounts, mixKeyHTML, swellingOutlines, separateStates,
	};
})();
