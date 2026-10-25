// Run with: playwright-cli -s=viewer run-code --filename=tools/check-pages.js
async (page) => {
    const base = 'http://localhost/viewer3d/';
    const pages = ['index.html', 'ble-sensor.html', 'jpiot-pcb.html',
        'scientific-logger.html', 'material-preview.html', 'skybox-explorer.html'];
    const failures = [];
    const checks = [];
    const optionalFiles = new Set();
    page.on('request', request => {
        if (request.method() === 'HEAD' && request.url().endsWith('.jsonl')) optionalFiles.add(request.url());
    });
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => {
        if (response.status() === 404 && response.request().method() === 'HEAD' && optionalFiles.has(response.url())) return;
        if (response.status() >= 400) failures.push(response.status() + ' ' + response.url());
    });
    page.on('console', message => {
        if (message.text().includes('404') && optionalFiles.has(message.location().url)) return;
        if (message.type() === 'error') failures.push(message.text());
    });
    // Hardware connection is deliberately not initiated by this smoke check.
    page.on('dialog', dialog => dialog.dismiss());
    for (const name of pages) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(base + name);
        await page.locator('#mloader').waitFor({ state: 'hidden' });
        if (name === 'index.html') await page.locator('#miniloader').waitFor({ state: 'hidden' });
        for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
            await page.setViewportSize({ width, height });
            await page.screenshot({ path: 'output/playwright/' + name.replace('.html', '') + '-' + width + '.png' });
            const layout = await page.evaluate(() => {
                const body = getComputedStyle(document.body);
                const viewport = document.documentElement.clientWidth;
                const viewer = document.getElementById('mviewer').getBoundingClientRect();
                return { overflow: document.documentElement.scrollWidth > innerWidth,
                    top: parseFloat(body.paddingTop), bottom: parseFloat(body.paddingBottom),
                    viewport, left: viewer.left, right: viewport - viewer.right };
            });
            if (layout.overflow) failures.push(name + ': horizontal overflow at ' + width);
            if (['index.html', 'ble-sensor.html'].includes(name) &&
                (Math.abs(layout.top - height * .05) > 1 || Math.abs(layout.bottom - height * .05) > 1)) {
                failures.push(name + ': vertical padding differs from 5vh');
            }
            if (Math.abs(layout.left - layout.viewport * .05) > 1 ||
                Math.abs(layout.right - layout.viewport * .05) > 1 || Math.abs(layout.left - layout.right) > 1) {
                failures.push(name + ': viewer is not centered with 5% side margins at ' + width);
            }
        }
        if (name === 'ble-sensor.html') {
            const drivers = await page.evaluate(() => ({
                ble: typeof window.blx?.userSendCmd,
                store: typeof window.blStore,
                saver: typeof window.saveAs,
                terminal: Boolean(document.getElementById('blxTerminalCmd'))
            }));
            if (drivers.ble !== 'function' || drivers.store !== 'object' || drivers.saver !== 'function' || !drivers.terminal) {
                failures.push('Bluetooth driver/terminal initialization failed: ' + JSON.stringify(drivers));
            }
        }
        const back = page.getByRole('link', { name: 'Zurück', exact: true });
        if (await back.getAttribute('href') !== './index.html') failures.push(name + ': wrong back link');
        await back.click();
        await page.waitForURL(base + 'index.html');
        // Finish the destination's model loads before navigating to the next demo.
        await page.locator('#mloader').waitFor({ state: 'hidden' });
        await page.locator('#miniloader').waitFor({ state: 'hidden' });
        checks.push(name + ': centered at 1440, 390 and 320 pixels; back link works');
    }
    if (failures.length) throw new Error(failures.join('\n'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + 'index.html');
    return checks;
}
