// Run with: playwright-cli -s=presentation-start run-code --filename=tools/check-presentation-start.js
async (page) => {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/jpiot-pcb.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace(
            'const d3img2 = view3d(', 'const d3img2 = window.__viewer = view3d(') });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost/viewer3d/jpiot-pcb.html');
    // On a fresh page, accepting Laden's default must fetch the same real file as Presentation.
    await page.getByRole('button', { name: 'Flight Recorder', exact: true }).click();
    await page.evaluate(() => { window.prompt = (message, value) => { window.__loadDefault = value; return value; }; });
    const loadResponse = page.waitForResponse(response => response.url().endsWith('/flight-points-jpiot.jsonl'));
    await page.getByRole('dialog').getByRole('button', { name: 'Laden', exact: true }).click();
    assert((await loadResponse).status() === 200, 'Laden fetch succeeds over XAMPP');
    await page.waitForFunction(() => window.__viewer.flightRecorder.points.length === 14);
    assert(await page.evaluate(() => window.__loadDefault === 'flight-points-jpiot.jsonl'), 'Laden shares Presentation default');
    await page.getByRole('button', { name: 'Presentation', exact: true }).click();
    await page.waitForFunction(() => window.__viewer?.flightRecorder.currentIndex === 0 &&
        !window.__viewer.flightRecorder.isFlying && Number(getComputedStyle(window.__viewer.flightRecorder.infoBox).opacity) > .99);
    const initial = await page.evaluate(() => {
        const v = window.__viewer, r = v.flightRecorder;
        return { count: r.points.length, name: r.points[0].name, distance: v.camera.position.distanceTo(v.controls.target),
            expectedDistance: r.points[0].camera.distance, open: r.panel.open, text: r.infoBox.textContent };
    });
    assert(initial.count === 14 && initial.name === 'Overview' && !initial.open &&
        Math.abs(initial.distance - initial.expectedDistance) < 1e-8 && initial.text.includes('JPIoT'), 'default file starts first point');
    const source = await page.evaluate(async () => (await fetch('flight-points-jpiot.jsonl')).text());
    for (const [width, height] of [[1440, 900], [320, 568]]) {
        await page.setViewportSize({ width, height });
        assert(await page.locator('.jo3dflight-navigation').evaluate(nav => {
            const bounds = nav.getBoundingClientRect();
            return [...nav.children].every(button => {
                const r = button.getBoundingClientRect();
                return parseFloat(getComputedStyle(button).fontSize) >= 28 && r.left >= bounds.left && r.right <= bounds.right;
            });
        }), 'large navigation symbols fit at ' + width);
        assert(await page.locator('.jo3dlaunchers').evaluate(wrapper => {
            const buttons = [...wrapper.children].map(button => button.getBoundingClientRect());
            const box = wrapper.parentElement.getBoundingClientRect();
            return buttons.every(r => r.left >= box.left && r.right <= box.right) && buttons[0].right <= buttons[1].left;
        }), 'both launch buttons fit at ' + width);
        await page.screenshot({ path: `output/playwright/presentation-start-${width}.png` });
    }
    await page.locator('#mviewer').evaluate(v => v.dataset.flightRecorder = 'hidden');
    assert(!await page.getByRole('button', { name: 'Flight Recorder', exact: true }).isVisible() &&
        await page.getByRole('button', { name: 'Presentation', exact: true }).isVisible(), 'presentation remains available with editor hidden');
    await page.locator('#mviewer').evaluate(v => v.dataset.flightRecorder = 'visible');
    await page.route('**/empty-presentation.jsonl', route => route.fulfill({ body: '' }));
    await page.route('**/missing-presentation.jsonl', route => route.fulfill({ status: 404, body: 'Not found' }));
    await page.route('**/broken-presentation.jsonl', route => route.fulfill({ body: '{broken' }));
    for (const name of ['empty', 'missing', 'broken']) {
        const result = await page.evaluate(async name => {
            const r = window.__viewer.flightRecorder;
            const before = JSON.stringify(r.points);
            const success = await r.startPresentation(`${name}-presentation.jsonl`);
            return { success, preserved: before === JSON.stringify(r.points), open: r.panel.open,
                message: r.panel.querySelector('.jo3dflight-status').textContent };
        }, name);
        assert(!result.success && result.preserved && result.open && result.message.includes('Laden fehlgeschlagen'), name + ': visible error preserves list');
    }
    await page.route('**/slow-presentation.jsonl', async route => {
        await page.waitForTimeout(200);
        await route.fulfill({ body: source }).catch(() => {});
    });
    const cancelled = await page.evaluate(async () => {
        const v = window.__viewer, r = v.flightRecorder;
        const pending = r.startPresentation('slow-presentation.jsonl');
        r.startAutoRotation();
        const cancelled = !await pending && !v.controls.autoRotate && r.isFlying;
        r.update(1000);
        return cancelled && v.controls.autoRotate && !r.isPresenting && r.presentationButton.textContent === 'Presentation';
    });
    assert(cancelled, 'Auto cancels a pending presentation start');
    await page.evaluate(() => {
        const v = window.__viewer;
        v.flightRecorder.reset();
        window.__originalReady = v.ready;
        v.ready = new Promise(resolve => { window.__releaseReady = resolve; });
        window.__startPending = v.flightRecorder.startPresentation();
    });
    await page.waitForTimeout(200);
    assert(await page.evaluate(() => window.__viewer.flightRecorder.points.length === 0 &&
        window.__viewer.flightRecorder.presentationButton.getAttribute('aria-busy') === 'true'), 'start waits for model readiness');
    assert(await page.evaluate(async () => {
        const v = window.__viewer;
        window.__releaseReady(v); const success = await window.__startPending;
        v.ready = window.__originalReady;
        return success && v.flightRecorder.points.length === 14;
    }), 'start continues after readiness');
    await page.route('**/custom-presentation.jsonl', route => route.fulfill({ body: source.split('\n')[1] }));
    const custom = await page.evaluate(async () => {
        const v = window.__viewer;
        v.container.dataset.presentationFile = 'custom-presentation.jsonl';
        const success = await v.flightRecorder.startPresentation();
        delete v.container.dataset.presentationFile;
        return success && v.flightRecorder.points.length === 1 && v.flightRecorder.points[0].name === 'Modem';
    });
    assert(custom, 'HTML file override');
    await page.getByRole('button', { name: 'Flight Recorder', exact: true }).click();
    await page.evaluate(() => { window.prompt = (message, value) => { window.__loadDefault = value; return null; }; });
    await page.getByRole('dialog').getByRole('button', { name: 'Laden', exact: true }).click();
    assert(await page.evaluate(() => window.__loadDefault === 'custom-presentation.jsonl'), 'Laden remembers last successful file');
    await page.evaluate(() => window.__viewer.flightRecorder.startPresentation());
    const timing = await page.evaluate(() => {
        const v = window.__viewer, r = v.flightRecorder;
        v.renderer.setAnimationLoop(null);
        const measure = distance => {
            r.stop();
            v.controls.target.set(0, 0, 0); v.camera.position.set(0, 0, 2); v.camera.lookAt(v.controls.target);
            const point = { ...v.getViewport(), name: 'Timing', info: '' };
            point.camera.position = [0, 0, 2 + distance]; point.camera.distance = 2 + distance;
            return r.flyTo(point);
        };
        const short = measure(.5), long = measure(4);
        r.flyTo(12); r.update(1000);
        const from = v.camera.position.clone();
        const first = r.points[0].camera.position;
        const oldUndersideToTop = 2 * Math.hypot(...first.map((n, i) => n - from.toArray()[i]));
        const undersideToTop = r.flyTo(0);
        r.update(1000);
        return { short, long, oldUndersideToTop, undersideToTop };
    });
    assert(Math.abs(timing.short - 1) < 1e-8 && Math.abs(timing.long - 4) < 1e-8 &&
        timing.undersideToTop < timing.oldUndersideToTop, 'short timings preserved and long flights faster: ' + JSON.stringify(timing));
    await page.evaluate(() => window.__viewer.dispose());
    assert(await page.locator('.jo3dlaunchers').count() === 0, 'launchers cleaned up');
    assert(errors.length === 0, errors.join('\n'));
    await page.unrouteAll({ behavior: 'wait' });
    return { result: 'Default presentation, first point, launchers, failures, cancellation, readiness and file override passed', timing };
}
