// Tabs above the homepage map. "Counties" is the map on this page; the other
// tabs embed pages from experiments/ (with ?embed=1, which hides their
// navigation and intro), each loaded the first time its tab is opened. The
// open tab is kept in the URL hash, e.g. #isoglosses.

(function () {
	"use strict";

	const VIEWS = {
		"isoglosses": {
			page: "experiments/isoglosses.html",
			caption: "Smoothed lines around the areas where pop, soda, coke or \"other\" reaches 50%, 75% or 90% of nearby responses, in the US and Canada.",
		},
		"zip-voronoi": {
			page: "experiments/zip-voronoi.html",
			caption: "One cell for each ZIP code and Canadian postal area, colored by its mix of answers.",
		},
		"county-bubbles": {
			page: "experiments/county-bubbles.html",
			settings: "circles=blend&size-by=population&size=0.35",
			caption: "One circle per county, sized by its population, colored by its mix of answers, and pushed apart so none overlap.",
		},
		"state-donuts": {
			page: "experiments/state-donuts.html",
			caption: "One donut per state, province and territory, sized by its number of responses and split by answer.",
		},
	};

	const tabs = [...document.querySelectorAll("[role=tab][data-tab]")];
	const mapPanel = document.getElementById("map");
	const viewPanel = document.getElementById("view-panel");
	const caption = document.getElementById("view-caption");
	const fullLink = document.getElementById("view-full");
	const reading = document.getElementById("reading"); // describes the county map only
	const frames = {};

	// Size the frame to its page's content, and keep it sized as that changes.
	function fitFrame(frame) {
		const doc = frame.contentDocument;
		if (!doc || !doc.body) return;
		const fit = () => { frame.style.height = Math.ceil(doc.body.getBoundingClientRect().height) + "px"; };
		new ResizeObserver(fit).observe(doc.body);
		fit();
	}

	function frameFor(name) {
		if (frames[name]) return frames[name];
		const view = VIEWS[name];
		const frame = document.createElement("iframe");
		frame.className = "view-frame";
		frame.title = document.getElementById("tab-" + name).textContent + " map";
		frame.src = `${view.page}?embed=1${view.settings ? "&" + view.settings : ""}`;
		frame.addEventListener("load", () => fitFrame(frame));
		viewPanel.append(frame);
		return (frames[name] = frame);
	}

	function select(name, { focus = false, updateHash = true } = {}) {
		if (name !== "counties" && !VIEWS[name]) name = "counties";
		for (const tab of tabs) {
			const on = tab.dataset.tab === name;
			tab.setAttribute("aria-selected", String(on));
			tab.tabIndex = on ? 0 : -1;
			if (on && focus) tab.focus();
		}
		mapPanel.hidden = name !== "counties";
		viewPanel.hidden = name === "counties";
		reading.hidden = name !== "counties";
		if (name !== "counties") {
			const view = VIEWS[name];
			viewPanel.setAttribute("aria-labelledby", "tab-" + name);
			caption.textContent = view.caption;
			fullLink.href = view.page + (view.settings ? "?" + view.settings : "");
			const frame = frameFor(name);
			for (const f of Object.values(frames)) f.hidden = f !== frame;
		}
		if (updateHash) {
			history.replaceState(null, "", name === "counties" ? location.pathname + location.search : "#" + name);
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

	window.addEventListener("hashchange", () => select(location.hash.slice(1), { updateHash: false }));
	if (location.hash) select(location.hash.slice(1), { updateHash: false });
})();
