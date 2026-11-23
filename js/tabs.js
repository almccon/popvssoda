// Tabs above the homepage map, named for how each shows the data.
// "Choropleth" is the map on this page; the other tabs embed pages from
// experiments/ (with ?embed=1, which hides their
// navigation and intro), each loaded the first time its tab is opened. The
// open tab is kept in the URL hash, e.g. #isoglosses.
//
// One region switch (US and Canada, US, Canada) applies to every tab: the
// choropleth gets a "pvs-region" event, and each embedded page is loaded with
// ?region=.

(function () {
	"use strict";

	const VIEWS = {
		"isoglosses": {
			page: "experiments/isoglosses.html",
			caption: "Smoothed lines around the areas where pop, soda, coke or \"other\" reaches 50%, 75% or 90% of nearby responses.",
		},
		"voronoi": {
			page: "experiments/voronoi.html",
			caption: "One cell for each ZIP code and Canadian postal area, colored by its mix of answers.",
		},
		"bubbles": {
			page: "experiments/bubbles.html",
			settings: "circles=blend&size-by=population&size=0.35",
			caption: "One circle per county, sized by its population, colored by its mix of answers, and pushed apart so none overlap.",
		},
		"donuts": {
			page: "experiments/donuts.html",
			caption: "One donut per state, province and territory, sized by its number of responses and split by answer.",
		},
	};

	const tabs = [...document.querySelectorAll("[role=tab][data-tab]")];
	const mapPanel = document.getElementById("map");
	const viewPanel = document.getElementById("view-panel");
	const framesEl = document.getElementById("view-frames");
	const caption = document.getElementById("view-caption");
	const fullLink = document.getElementById("view-full");
	const reading = document.getElementById("reading"); // describes the county map only
	const frames = {};
	const regionButtons = [...document.querySelectorAll("[data-region]")];
	let region = "both";
	const frameSrc = (name) => {
		const view = VIEWS[name];
		return `${view.page}?embed=1&region=${region}${view.settings ? "&" + view.settings : ""}`;
	};

	// Size the frame to its page's content, and keep it sized as that changes.
	function fitFrame(frame) {
		const doc = frame.contentDocument;
		if (!doc || !doc.body) return;
		// Only measure a frame that's showing: hidden, its page lays out at no
		// width (0 tall, or very tall where text wraps), and using that height
		// made the boxes below jump when switching back. Keep the last real one.
		const fit = () => {
			if (!frame.offsetWidth) return;
			const h = Math.ceil(doc.body.getBoundingClientRect().height);
			if (h > 0) {
				frame.style.height = h + "px";
				if (!frame.hidden) settleHold();
			}
		};
		new ResizeObserver(fit).observe(doc.body);
		fit();
	}

	function frameFor(name) {
		if (frames[name]) return frames[name];
		const view = VIEWS[name];
		const frame = document.createElement("iframe");
		frame.className = "view-frame";
		frame.title = document.getElementById("tab-" + name).textContent + " map";
		frame.src = frameSrc(name);
		frame.addEventListener("load", () => fitFrame(frame));
		framesEl.append(frame);
		return (frames[name] = frame);
	}

	// While a tab's page loads (or is measured after being hidden), keep the
	// panel at least as tall as what was showing before, so the boxes below
	// never move up into the map's space and then back down.
	let holdTimer = null;
	function holdHeight(height) {
		viewPanel.style.minHeight = height + "px";
		clearTimeout(holdTimer);
		holdTimer = setTimeout(releaseHold, 3000); // in case the page never reports
	}
	function releaseHold() {
		clearTimeout(holdTimer);
		viewPanel.style.minHeight = "";
	}
	// The shown page reported a height: let go once it has stopped changing.
	function settleHold() {
		if (!viewPanel.style.minHeight) return;
		clearTimeout(holdTimer);
		holdTimer = setTimeout(releaseHold, 400);
	}
	const shownPanel = () => (mapPanel.hidden ? viewPanel : mapPanel);

	function select(name, { focus = false, updateHash = true } = {}) {
		if (name !== "choropleth" && !VIEWS[name]) name = "choropleth";
		const before = shownPanel().getBoundingClientRect().height;
		for (const tab of tabs) {
			const on = tab.dataset.tab === name;
			tab.setAttribute("aria-selected", String(on));
			tab.tabIndex = on ? 0 : -1;
			if (on && focus) tab.focus();
		}
		mapPanel.hidden = name !== "choropleth";
		viewPanel.hidden = name === "choropleth";
		reading.hidden = name !== "choropleth";
		if (name !== "choropleth") {
			const view = VIEWS[name];
			viewPanel.setAttribute("aria-labelledby", "tab-" + name);
			caption.textContent = view.caption;
			fullLink.href = `${view.page}?region=${region}${view.settings ? "&" + view.settings : ""}`;
			holdHeight(before);
			const frame = frameFor(name);
			for (const f of Object.values(frames)) f.hidden = f !== frame;
		} else {
			releaseHold();
		}
		if (updateHash) {
			history.replaceState(null, "", name === "choropleth" ? location.pathname + location.search : "#" + name);
		}
	}

	for (const tab of tabs) {
		tab.addEventListener("click", () => select(tab.dataset.tab));
		tab.addEventListener("keydown", (event) => {
			const i = tabs.indexOf(tab);
			const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
			if (next === undefined) return;
			event.preventDefault();
			select(tabs[(next + tabs.length) % tabs.length].dataset.tab, { focus: true });
		});
	}

	function setRegion(value) {
		region = value;
		window.PVS_REGION = value; // for js/map.js, if its data is still loading
		for (const b of regionButtons) b.setAttribute("aria-pressed", String(b.dataset.region === value));
		document.dispatchEvent(new CustomEvent("pvs-region", { detail: value }));
		// Embedded pages take the region at load.
		if (!viewPanel.hidden) holdHeight(viewPanel.getBoundingClientRect().height);
		for (const [name, frame] of Object.entries(frames)) frame.src = frameSrc(name);
		const open = tabs.find((t) => t.getAttribute("aria-selected") === "true");
		if (open && VIEWS[open.dataset.tab]) {
			const view = VIEWS[open.dataset.tab];
			fullLink.href = `${view.page}?region=${region}${view.settings ? "&" + view.settings : ""}`;
		}
	}
	for (const b of regionButtons) b.addEventListener("click", () => setRegion(b.dataset.region));

	window.addEventListener("hashchange", () => select(location.hash.slice(1), { updateHash: false }));
	if (location.hash) select(location.hash.slice(1), { updateHash: false });
})();
