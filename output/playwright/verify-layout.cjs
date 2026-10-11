async (page) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const results = [];
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:8765/boilerplate.html');
    await page.locator('#mloader').waitFor({ state: 'hidden' });
    if (await page.getByRole('button', { name: 'Drehung aus' }).count() !== 1) throw new Error('Reduced motion failed');
    for (const [width, height] of [[1440,900], [390,844], [320,568], [844,390]]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(600);
        const dimensions = await page.evaluate(() => ({
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            height: innerHeight, scrollHeight: document.documentElement.scrollHeight,
            buffer: [...document.querySelectorAll('canvas')].map(c => [c.width,c.height])
        }));
        if (dimensions.scrollWidth > width || dimensions.scrollHeight > height) throw new Error('Layout overflow ' + width);
        await page.screenshot({ path: `output/playwright/boilerplate-final-${width}x${height}.png` });
        results.push(dimensions);
    }
    await page.getByRole('button', { name: 'Neutraler Hintergrund' }).click();
    await page.screenshot({ path: 'output/playwright/boilerplate-neutral.png' });
    await page.getByRole('button', { name: 'Zurücksetzen' }).click();
    for (const file of ['index.html', 'jpiot.html', 'index2.html']) {
        await page.goto('http://127.0.0.1:8765/' + file);
        await page.locator('#mloader').waitFor({ state: 'hidden', timeout: 20000 });
        results.push({ legacyPage: file, canvases: await page.locator('canvas').count() });
    }
    if (errors.length) throw new Error(JSON.stringify(errors));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:8765/boilerplate.html');
    return { result: 'PASS: layouts, reduced motion, toolbar, legacy pages; no page errors', results };
}
