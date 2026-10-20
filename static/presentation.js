document.querySelectorAll('[data-presentation-frame]').forEach((frame) => {
    const loader = frame.parentElement.querySelector('[data-presentation-loader]');

    frame.addEventListener('load', () => {
        if (loader) {
            loader.classList.add('hidden');
        }
        frame.classList.add('loaded');
    });
});
