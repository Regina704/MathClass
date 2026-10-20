const readConfig = window.READ_BLOCK_CONFIG;
if (readConfig) {
    window.setTimeout(async () => {
        await fetch('/api/local-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                block_id: readConfig.blockId,
                answer: 'viewed',
                solved: true,
                feedback: 'Блок просмотрен'
            })
        });
    });
}
