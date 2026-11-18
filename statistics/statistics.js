// Click a column heading to sort the rows of each section of the table.
// The pages work without this; it only adds sorting.
(function () {
	"use strict";
	document.querySelectorAll("table.sortable").forEach((table) => {
		const heads = [...table.tHead.rows[0].cells];
		heads.forEach((th, col) => {
			if (!th.dataset.sort) return;
			th.tabIndex = 0;
			const sort = () => {
				const numeric = th.dataset.sort === "num";
				// Numbers sort largest first on the first click, names A–Z.
				const ascending = th.getAttribute("aria-sort")
					? th.getAttribute("aria-sort") !== "ascending"
					: !numeric;
				heads.forEach((h) => h.removeAttribute("aria-sort"));
				th.setAttribute("aria-sort", ascending ? "ascending" : "descending");
				const value = (row) => {
					const v = row.cells[col].dataset.value;
					return numeric ? +v : v;
				};
				for (const body of table.tBodies) {
					if (body.classList.contains("subtotal")) continue;
					const rows = [...body.rows].filter((r) => !r.classList.contains("group"));
					rows.sort((a, b) => {
						const x = value(a), y = value(b);
						const d = numeric ? x - y : String(x).localeCompare(String(y));
						return ascending ? d : -d;
					});
					rows.forEach((r) => body.appendChild(r));
				}
			};
			th.addEventListener("click", sort);
			th.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sort(); }
			});
		});
	});
})();
