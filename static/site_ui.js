(function () {
    const THEME_KEY = "matematichno-theme";

    function applyTheme(theme) {
        const isLight = theme === "light";
        document.documentElement.classList.toggle("light", isLight);
        document.body.classList.toggle("light", isLight);
        document.querySelectorAll("[data-site-theme-toggle]").forEach((button) => {
            button.textContent = isLight ? "☀" : "☾";
            button.title = isLight ? "Включить темную тему" : "Включить светлую тему";
        });
    }

    function initTheme() {
        applyTheme(localStorage.getItem(THEME_KEY) || "dark");
        document.querySelectorAll("[data-site-theme-toggle]").forEach((button) => {
            button.addEventListener("click", () => {
                const nextTheme = document.body.classList.contains("light") ? "dark" : "light";
                localStorage.setItem(THEME_KEY, nextTheme);
                applyTheme(nextTheme);
                window.dispatchEvent(new CustomEvent("matematichno-theme-change", {
                    detail: { theme: nextTheme }
                }));
            });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initTheme);
    } else {
        initTheme();
    }
})();
