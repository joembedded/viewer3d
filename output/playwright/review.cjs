async (page) => {
    const context = await page.context().browser().newContext({
        viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
        isMobile: true, hasTouch: true
    });
    const mobile = await context.newPage();
    const errors = [];
    mobile.on('pageerror', error => errors.push(error.message));
    mobile.on('response', response => { if (response.status() >= 400) errors.push(response.url()); });
    await mobile.goto('http://127.0.0.1:8765/jpiot.html');
    await mobile.waitForFunction(() => document.getElementById('mloader').style.display === 'none');
    await mobile.evaluate(() => new Promise(resolve => {
        let frames = 0;
        const tick = () => ++frames >= 90 ? resolve() : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
    }));
    const results = [];
    for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
        await mobile.setViewportSize({width, height});
        await mobile.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const metrics = await mobile.evaluate(() => {
            const viewer = document.getElementById('mviewer').getBoundingClientRect();
            const canvas = document.querySelector('canvas');
            const rect = canvas.getBoundingClientRect();
            return {
                viewport: [innerWidth, innerHeight],
                page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
                outerEdges: [viewer.left, innerWidth - viewer.right, innerHeight - viewer.bottom],
                borders: [rect.left - viewer.left, rect.top - viewer.top, viewer.right - rect.right, viewer.bottom - rect.bottom],
                renderScale: canvas.width / canvas.clientWidth
            };
        });
        if (metrics.page[0] !== width || metrics.page[1] !== height ||
            metrics.borders.some(border => Math.abs(border - 1) > 0.01) ||
            metrics.outerEdges.some(edge => edge !== 10) || metrics.renderScale > 2.01) {
            throw new Error(JSON.stringify(metrics));
        }
        results.push(metrics);
        await mobile.screenshot({path: `output/playwright/final-${width}x${height}.png`, scale: 'css'});
    }
    await mobile.setViewportSize({width: 390, height: 844});
    const cdp = await context.newCDPSession(mobile);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 150, y: 420}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 230, y: 450}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(JSON.stringify({results, errors, touchDrag: 'completed'}));
    await context.close();
}
