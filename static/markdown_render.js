(() => {
    function appendInline(parent, text) {
        const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
        let cursor = 0;
        let match;

        while ((match = pattern.exec(text)) !== null) {
            if (match.index > cursor) {
                parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
            }

            const token = match[0];
            if (token.startsWith('**')) {
                const strong = document.createElement('strong');
                strong.textContent = token.slice(2, -2);
                parent.appendChild(strong);
            } else {
                const code = document.createElement('code');
                code.textContent = token.slice(1, -1);
                parent.appendChild(code);
            }
            cursor = pattern.lastIndex;
        }

        if (cursor < text.length) {
            parent.appendChild(document.createTextNode(text.slice(cursor)));
        }
    }

    function createCodeBlock(code, language) {
        const wrapper = document.createElement('div');
        wrapper.className = 'markdown-code-block';

        const header = document.createElement('div');
        header.className = 'markdown-code-head';
        const label = document.createElement('span');
        label.textContent = language || 'code';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Скопировать';
        button.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(code);
                button.textContent = 'Скопировано';
                window.setTimeout(() => {
                    button.textContent = 'Скопировать';
                }, 1400);
            } catch (error) {
                button.textContent = 'Ошибка';
                window.setTimeout(() => {
                    button.textContent = 'Скопировать';
                }, 1400);
            }
        });
        header.appendChild(label);
        header.appendChild(button);

        const pre = document.createElement('pre');
        const codeNode = document.createElement('code');
        codeNode.textContent = code;
        pre.appendChild(codeNode);

        wrapper.appendChild(header);
        wrapper.appendChild(pre);
        return wrapper;
    }

    function createImageBlock(alt, src) {
        const figure = document.createElement('figure');
        figure.className = 'markdown-image';

        const image = document.createElement('img');
        image.src = src;
        image.alt = alt || '';
        image.loading = 'lazy';
        figure.appendChild(image);

        if (alt) {
            const caption = document.createElement('figcaption');
            caption.textContent = alt;
            figure.appendChild(caption);
        }

        return figure;
    }

    function flushParagraph(container, lines) {
        if (!lines.length) return;
        const paragraph = document.createElement('p');
        appendInline(paragraph, lines.join(' '));
        container.appendChild(paragraph);
        lines.length = 0;
    }

    function flushList(container, items) {
        if (!items.length) return;
        const list = document.createElement('ul');
        items.forEach((item) => {
            const li = document.createElement('li');
            appendInline(li, item);
            list.appendChild(li);
        });
        container.appendChild(list);
        items.length = 0;
    }

    function renderMarkdown(source) {
        const container = document.createElement('div');
        const lines = source.replace(/\r\n/g, '\n').split('\n');
        const paragraphLines = [];
        const listItems = [];
        let inCode = false;
        let codeLanguage = '';
        let codeLines = [];

        lines.forEach((line) => {
            const fence = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
            if (fence) {
                if (inCode) {
                    container.appendChild(createCodeBlock(codeLines.join('\n'), codeLanguage));
                    codeLines = [];
                    codeLanguage = '';
                    inCode = false;
                } else {
                    flushParagraph(container, paragraphLines);
                    flushList(container, listItems);
                    inCode = true;
                    codeLanguage = fence[1] || 'code';
                }
                return;
            }

            if (inCode) {
                codeLines.push(line);
                return;
            }

            const trimmed = line.trim();
            if (!trimmed) {
                flushParagraph(container, paragraphLines);
                flushList(container, listItems);
                return;
            }

            const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
            if (heading) {
                flushParagraph(container, paragraphLines);
                flushList(container, listItems);
                const level = String(Math.min(heading[1].length + 1, 5));
                const h = document.createElement(`h${level}`);
                appendInline(h, heading[2]);
                container.appendChild(h);
                return;
            }

            const image = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
            if (image) {
                flushParagraph(container, paragraphLines);
                flushList(container, listItems);
                container.appendChild(createImageBlock(image[1], image[2]));
                return;
            }

            const list = trimmed.match(/^[-*]\s+(.+)$/);
            if (list) {
                flushParagraph(container, paragraphLines);
                listItems.push(list[1]);
                return;
            }

            flushList(container, listItems);
            paragraphLines.push(trimmed);
        });

        if (inCode) {
            container.appendChild(createCodeBlock(codeLines.join('\n'), codeLanguage));
        }
        flushParagraph(container, paragraphLines);
        flushList(container, listItems);
        return container;
    }

    function hydrateMarkdownBlocks() {
        document.querySelectorAll('[data-markdown]').forEach((element) => {
            const source = element.textContent || '';
            element.textContent = '';
            element.appendChild(renderMarkdown(source));
            element.classList.add('markdown-rendered');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hydrateMarkdownBlocks);
    } else {
        hydrateMarkdownBlocks();
    }
})();
