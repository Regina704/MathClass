(function () {
    const formulas = [
        "y = sin(x)",
        "x^2 + y^2 = r^2",
        "f'(x) = lim h->0",
        "a^2 + b^2 = c^2",
        "S = pi r^2",
        "y = ax^2 + bx + c",
        "log_a(xy) = log_a x + log_a y",
        "int_a^b f(x) dx",
        "y = k / x",
        "cos^2 x + sin^2 x = 1"
    ];

    function buildFormulaLayer() {
        document.querySelectorAll("[data-math-formulas]").forEach((layer) => {
            if (layer.dataset.ready === "true") return;
            layer.dataset.ready = "true";

            const rows = window.matchMedia("(max-width: 720px)").matches ? [14, 78] : [8, 24, 68, 84];
            const count = rows.length;
            for (let index = 0; index < count; index += 1) {
                const item = document.createElement("span");
                item.className = "math-bg-formula";
                item.textContent = formulas[index % formulas.length];
                item.style.setProperty("--formula-top", `${rows[index]}%`);
                item.style.setProperty("--formula-delay", `${index * 28 + Math.random() * 12}s`);
                item.style.setProperty("--formula-duration", `${128 + Math.random() * 64}s`);
                item.style.setProperty("--formula-scale", `${0.9 + Math.random() * 0.22}`);
                layer.appendChild(item);
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", buildFormulaLayer);
    } else {
        buildFormulaLayer();
    }
})();
