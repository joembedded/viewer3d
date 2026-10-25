// Run with: playwright-cli -s=presentation-update run-code --filename=tools/check-presentation-responsive.js
async (page) => {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = 'http://localhost/viewer3d/';
    // Real files on XAMPP: each model gets its own optional JSONL companion.
    for (const name of ['index', 'ble-sensor', 'scientific-logger', 'material-preview', 'skybox-explorer', 'jpiot-pcb']) {
        const probes = [];
        const onRequest = request => {
            if (request.method() === 'HEAD' && request.url().endsWith('.jsonl')) probes.push(request);
        };
        page.on('request', onRequest);
        await page.goto(base + name + '.html');
        await page.locator('#mloader').waitFor({ state: 'hidden' });
        if (name === 'index') await page.locator('#miniloader').waitFor({ state: 'hidden' });
        assert(probes.length > 0, name + ': companion checked');
        let available = 0;
        for (const request of probes) {
            const response = await request.response();
            assert(response && [200, 404].includes(response.status()), name + ': companion presence');
            if (response.ok()) available++;
        }
        await page.waitForTimeout(100);
        assert(await page.getByRole('button', { name: 'Presentation', exact: true }).count() ===
            available, name + ': launcher visibility');
        page.off('request', onRequest);
    }
    await page.route('**/jpiot-pcb.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace(
            'const d3img2 = view3d(', 'const d3img2 = window.__viewer = view3d(') });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + 'jpiot-pcb.html');
    await page.evaluate(() => window.__viewer.ready.then(() => undefined));
    await page.getByRole('button', { name: 'Presentation', exact: true }).click();
    await page.waitForFunction(() => window.__viewer.flightRecorder.currentIndex === 0);
    const box = page.locator('.jo3dflight-info');
    const toggle = box.locator('.jo3dflight-info-toggle');
    const text = box.locator('p');
    await page.waitForTimeout(1300);
    assert(await text.isVisible(), 'desktop stays expanded');
    await toggle.click();
    assert(!await text.isVisible(), 'desktop manual collapse');
    await toggle.click();
    await text.waitFor({ state: 'visible' });
    assert(await text.isVisible(), 'desktop manual expansion');
    const sizes = [[1024, 768], [768, 1024], [390, 844], [320, 568], [1200, 500]];
    for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => {
            const r = window.__viewer.flightRecorder;
            r.flyTo(0); r.update(1000);
        });
        await page.waitForTimeout(350);
        assert(await text.isVisible(), width + ': text initially visible');
        const expanded = await box.boundingBox();
        await page.waitForTimeout(1300);
        assert(await text.isVisible(), width + ': remains expanded beyond one second');
        await page.waitForTimeout(1100);
        assert(!await text.isVisible() && await toggle.getAttribute('aria-expanded') === 'false', width + ': auto collapse');
        assert((await box.boundingBox()).height < expanded.height, width + ': shrinks');
        assert(await box.evaluate(b => {
            const bounds = b.getBoundingClientRect(), parent = b.parentElement.getBoundingClientRect();
            return bounds.left >= parent.left && bounds.right <= parent.right && bounds.bottom <= parent.bottom &&
                [...b.querySelectorAll('button')].every(button => {
                    const r = button.getBoundingClientRect();
                    return r.left >= bounds.left && r.right <= bounds.right && r.bottom <= bounds.bottom;
                });
        }), width + ': compact box and controls fit');
        await page.screenshot({ path: `output/playwright/presentation-collapsed-${width}.png` });
        await toggle.click();
        await page.waitForTimeout(1300);
        assert(await text.isVisible(), width + ': manual expansion remains open');
        await page.screenshot({ path: `output/playwright/presentation-expanded-${width}.png` });
        await toggle.click();
        await box.getByRole('button', { name: 'Nächsten Punkt anfliegen' }).click();
        await page.evaluate(() => window.__viewer.flightRecorder.update(1000));
        await text.waitFor({ state: 'visible' });
        assert(await text.isVisible(), width + ': new point expands again');
    }
    await page.evaluate(() => window.__viewer.dispose());
    await page.waitForTimeout(1200);
    assert(await box.count() === 0, 'dispose removes info and pending timer');
    assert(errors.length === 0, errors.join('\n'));
    await page.unrouteAll({ behavior: 'wait' });
    return 'Real companion files and launcher visibility on all six pages; automatic/manual collapse, navigation and cleanup at five viewport sizes passed.';
}
