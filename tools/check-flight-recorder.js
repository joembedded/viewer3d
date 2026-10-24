// Run with: playwright-cli -s=flight run-code --filename=tools/check-flight-recorder.js
async (page) => {
    const base = 'http://localhost/viewer3d/';
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/scientific-logger.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text())
            .replace('const viewer = view3dDocumentation(', 'const viewer = window.__viewer = view3dDocumentation(')
            .replace("model: './models/Rundlogger.glb',", "transTime: 0.1, model: './models/Rundlogger.glb',") });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + 'scientific-logger.html');
    await page.evaluate(() => window.__viewer.ready.then(() => undefined));
    const launcher = page.getByRole('button', { name: 'Flight Recorder', exact: true });
    await launcher.click();
    const panel = page.getByRole('dialog');
    assert(await panel.isVisible(), 'editor opens');
    assert(await panel.locator('.jo3dflight-toolbar button').allTextContents().then(labels =>
        labels.join('|') === 'Reset|View loggen|Laden|Export|Auto'), 'five actions in requested order');
    assert(await page.evaluate(() => !window.__viewer.controls.autoRotate), 'opening stops auto rotation');
    const promptAction = async (action, reply) => {
        // CLI modal tracking yields early on native prompts, so provide deterministic answers here.
        await page.evaluate(value => { window.prompt = () => value; }, reply);
        await action();
    };
    const record = name => promptAction(() => panel.getByRole('button', { name: 'View loggen', exact: true }).click(), name);
    await record(null);
    await record('   ');
    assert(await panel.locator('.jo3dflight-go').count() === 0, 'cancel/empty names add nothing');
    await record('Front');
    assert(await panel.getByRole('textbox').inputValue() === 'Front-YourCommentsHere', 'default Info');
    await panel.getByRole('textbox').fill('Front: Anschlüsse zeigen\n');
    await page.evaluate(() => {
        const v = window.__viewer;
        v.camera.position.set(-.8, .6, 1.2);
        v.controls.target.set(.1, .02, 0);
        v.controls.update(0);
        v.camera.zoom = 1.2;
        v.camera.fov = 50;
        v.camera.updateProjectionMatrix();
        v.model.rotation.x += .4;
        v.modRotTarget.set(v.model.rotation.x, v.model.rotation.y, v.model.rotation.z);
        v.modelscale = v.targetscale = v.model.scale.x * .8;
        v.model.scale.setScalar(v.modelscale);
        v.invalidate();
    });
    await record('Rear <view>');
    assert(await panel.locator('.jo3dflight-go').count() === 2, 'two recorded points');
    const recorded = await page.evaluate(() => window.__viewer.flightRecorder.points);
    await panel.getByRole('button', { name: 'Front', exact: true }).click();
    await page.waitForFunction(() => !window.__viewer.flightRecorder.isFlying);
    const arrival = await page.evaluate(async () => {
        const v = window.__viewer;
        const first = v.getViewport();
        for (let i = 0; i < 15; i++) await new Promise(requestAnimationFrame);
        return { first, later: v.getViewport(), presenting: v.flightRecorder.isPresenting };
    });
    const closeArrays = (a, b) => a.every((n, i) => Math.abs(n - b[i]) < 1e-8);
    assert(closeArrays(arrival.first.camera.position, recorded[0].camera.position) &&
        closeArrays(arrival.first.camera.target, recorded[0].camera.target) &&
        closeArrays(arrival.first.camera.quaternion, recorded[0].camera.quaternion) &&
        closeArrays(arrival.first.model.quaternion, recorded[0].model.quaternion) &&
        closeArrays(arrival.first.model.scale, recorded[0].model.scale) &&
        arrival.first.camera.zoom === recorded[0].camera.zoom && arrival.first.camera.fov === recorded[0].camera.fov,
        'flight reaches recorded camera and model pose');
    assert(arrival.presenting && JSON.stringify(arrival.first) === JSON.stringify(arrival.later), 'destination remains still');
    await panel.getByRole('button', { name: 'Auto', exact: true }).click();
    await page.waitForFunction(() => window.__viewer.controls.autoRotate && !window.__viewer.flightRecorder.isFlying);
    const auto = await page.evaluate(async () => {
        const v = window.__viewer;
        const before = v.camera.position.clone();
        for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
        return v.controls.autoRotate && !v.flightRecorder.isPresenting &&
            before.distanceTo(v.camera.position) > 1e-6;
    });
    assert(auto, 'Auto button releases the presentation and visibly resumes rotation');
    await page.evaluate(() => window.__viewer.setAutoRotate(false));
    const downloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    assert(download.suggestedFilename() === 'flight-points-mviewer.jsonl', 'JSONL download filename');
    await download.saveAs('output/playwright/flight-roundtrip.jsonl');
    const exported = await page.evaluate(async () => (await fetch('output/playwright/flight-roundtrip.jsonl')).text());
    const lines = exported.trim().split('\n');
    assert(lines.length === 2 && JSON.stringify(lines.map(JSON.parse)) === JSON.stringify(recorded), 'download contains exact JSONL and edited Info');
    await panel.getByRole('button', { name: 'Reset', exact: true }).click();
    assert(await panel.locator('.jo3dflight-go').count() === 0, 'Reset clears without prompt');
    const load = file => promptAction(() => panel.getByRole('button', { name: 'Laden', exact: true }).click(), file);
    await load('output/playwright/flight-roundtrip.jsonl');
    await page.waitForFunction(() => window.__viewer.flightRecorder.points.length === 2);
    assert(JSON.stringify(await page.evaluate(() => window.__viewer.flightRecorder.points)) === JSON.stringify(recorded), 'export/import round trip');
    await page.route('**/invalid-flight.jsonl', route => route.fulfill({ body: lines[0] + '\n' + '{broken' }));
    await load('invalid-flight.jsonl');
    await page.waitForFunction(() => document.querySelector('.jo3dflight-status').textContent.includes('Zeile 2'));
    assert(await panel.locator('.jo3dflight-go').count() === 2, 'invalid import preserves list');
    await page.route('**/missing-flight.jsonl', route => route.fulfill({ status: 404, body: 'Not found' }));
    await load('missing-flight.jsonl');
    await page.waitForFunction(() => document.querySelector('.jo3dflight-status').textContent.includes('HTTP 404'));
    assert(await panel.locator('.jo3dflight-go').count() === 2, 'HTTP error preserves list');
    await page.route('**/slow-flight.jsonl', async route => {
        await page.waitForTimeout(250);
        await route.fulfill({ body: exported }).catch(() => {});
    });
    await load('slow-flight.jsonl');
    await panel.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForTimeout(350);
    assert(await panel.locator('.jo3dflight-go').count() === 0, 'Reset cancels pending import');
    await load('output/playwright/flight-roundtrip.jsonl');
    await page.waitForFunction(() => window.__viewer.flightRecorder.points.length === 2);

    const manyPoints = Array.from({ length: 40 }, (_, i) => ({ ...recorded[0], name: `Punkt ${i + 1}` }));
    await page.route('**/many-flight-points.jsonl', route => route.fulfill({
        body: manyPoints.map(point => JSON.stringify(point)).join('\n')
    }));
    await load('many-flight-points.jsonl');
    await page.waitForFunction(() => window.__viewer.flightRecorder.points.length === 40);
    for (const [width, height] of [[1440, 900], [320, 568]]) {
        await page.setViewportSize({ width, height });
        const scroller = panel.locator('.jo3dflight-points');
        assert(await scroller.evaluate(s => s.scrollHeight > s.clientHeight && s.clientHeight > 60 &&
            getComputedStyle(s).overflowY === 'auto'), 'long list scrolls at width ' + width);
        await panel.getByRole('button', { name: 'Punkt 40', exact: true }).scrollIntoViewIfNeeded();
        assert(await scroller.evaluate(s => {
            const row = s.lastElementChild.getBoundingClientRect(), frame = s.getBoundingClientRect();
            return s.scrollTop > 0 && row.bottom <= frame.bottom + 1;
        }), 'last point remains reachable at width ' + width);
        assert(await panel.evaluate(p => {
            const frame = p.getBoundingClientRect(), toolbar = p.querySelector('.jo3dflight-toolbar').getBoundingClientRect();
            return frame.top >= 0 && frame.bottom <= innerHeight && toolbar.top >= frame.top &&
                toolbar.bottom <= frame.bottom && p.scrollHeight <= p.clientHeight;
        }), 'toolbar stays visible and only the list scrolls at width ' + width);
        await page.screenshot({ path: `output/playwright/flight-recorder-many-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await load('output/playwright/flight-roundtrip.jsonl');
    await page.waitForFunction(() => window.__viewer.flightRecorder.points.length === 2);

    // Deterministic intermediate frames: arc, duration, retarget, interruption and resize.
    const flightChecks = await page.evaluate(async () => {
        const v = window.__viewer, r = v.flightRecorder;
        v.renderer.setAnimationLoop(null);
        const [a, b] = r.points;
        r.flyTo(b);
        r.startAutoRotation();
        const returning = !v.controls.autoRotate && r.isFlying;
        r.update(1000);
        const scriptAuto = returning && v.controls.autoRotate && !r.isFlying && !r.isPresenting;
        r.flyTo(a); r.update(1000);
        const duration = r.flyTo(b);
        const expected = .1 * Math.max(Math.hypot(...a.camera.position.map((n, i) => n - b.camera.position[i])),
            Math.hypot(...a.camera.target.map((n, i) => n - b.camera.target[i])), .25);
        r.update(duration / 2);
        const halfway = v.getViewport();
        const interpolated = halfway.camera.zoom > a.camera.zoom && halfway.camera.zoom < b.camera.zoom;
        const beforeRetarget = JSON.stringify(halfway);
        r.flyTo(a);
        const continuous = JSON.stringify(v.getViewport()) === beforeRetarget;
        v.controls.dispatchEvent({ type: 'start' });
        const interrupted = !r.isFlying && !r.isPresenting;
        v.controls.dispatchEvent({ type: 'end' });
        r.flyTo(b); r.update(1000);
        const fov = v.camera.fov;
        window.dispatchEvent(new Event('resize'));
        const resizePreservesFov = v.camera.fov === fov;
        v.setAutoRotate(true);
        const rotationResumes = !r.isPresenting && v.controls.autoRotate;
        v.setAutoRotate(false);
        // Verify an opposite-side flight stays away from the target at its midpoint.
        const opposite = structuredClone(a);
        opposite.camera.position = a.camera.position.map((n, i) => i === 1 ? n : -n);
        v.camera.position.fromArray(opposite.camera.position);
        v.controls.target.fromArray(a.camera.target);
        v.camera.lookAt(v.controls.target);
        opposite.camera.quaternion = v.camera.quaternion.toArray();
        r.flyTo(a); r.update(1000);
        const orbitDuration = r.flyTo(opposite);
        r.update(orbitDuration / 2);
        const radius = v.camera.position.distanceTo(v.controls.target);
        const arc = radius > .5;
        r.stop();
        const { parseFlightPoints, TRANSTIME } = await import('./driver_js/flight-recorder.js');
        let rejected = 0;
        for (const mutate of [p => p.camera.zoom = -1, p => p.camera.position = [1, 2],
            p => p.camera.quaternion = [0, 0, 0, 0], p => p.model.scale = [0, 1, 1], p => p.version = 99]) {
            const point = structuredClone(a); mutate(point);
            try { parseFlightPoints(JSON.stringify(point)); } catch { rejected++; }
        }
        const portable = parseFlightPoints('\uFEFF' + JSON.stringify(a) + '\r\n\r\n').length === 1;
        return { duration, expected, interpolated, continuous, interrupted, resizePreservesFov, rotationResumes, scriptAuto, arc, rejected, portable, TRANSTIME };
    });
    assert(Math.abs(flightChecks.duration - flightChecks.expected) < 1e-8 && flightChecks.interpolated &&
        flightChecks.continuous && flightChecks.interrupted && flightChecks.resizePreservesFov &&
        flightChecks.rotationResumes && flightChecks.scriptAuto && flightChecks.arc && flightChecks.rejected === 5 &&
        flightChecks.portable && flightChecks.TRANSTIME === 2, 'flight math/validation: ' + JSON.stringify(flightChecks));
    await page.screenshot({ path: 'output/playwright/flight-recorder-desktop.png' });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.screenshot({ path: 'output/playwright/flight-recorder-mobile.png' });
    assert(await panel.evaluate(p => {
        const r = p.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && p.scrollWidth <= p.clientWidth;
    }), 'editor fits small mobile screen');
    await panel.getByRole('textbox').first().focus();
    await page.keyboard.press('v');
    assert(await panel.locator('.jo3dflight-go').count() === 2, 'typing in Info does not record');
    await page.keyboard.press('Escape');
    assert(!await panel.isVisible(), 'Escape closes editor');
    const disposed = await page.evaluate(() => {
        const v = window.__viewer;
        v.dispose(); v.dispose();
        return !document.querySelector('.jo3dflight') && !document.querySelector('.jo3dviewport-button');
    });
    assert(disposed, 'dispose removes editor and launcher');

    await page.goto(base + 'index.html');
    await page.locator('#mloader').waitFor({ state: 'hidden' });
    await page.locator('#miniloader').waitFor({ state: 'hidden' });
    await page.locator('#mviewer .jo3dviewport-button').click();
    await promptAction(() => page.locator('#mviewer-flight-recorder').getByRole('button', { name: 'View loggen', exact: true }).click(), 'Main');
    await page.locator('#mviewer-flight-recorder').getByRole('button', { name: 'Flight Recorder schließen' }).click();
    await page.locator('#vmini .jo3dviewport-button').click();
    assert(await page.locator('#vmini-flight-recorder .jo3dflight-go').count() === 0, 'multiple viewers keep independent lists');
    await page.locator('#vmini-flight-recorder').getByRole('button', { name: 'Flight Recorder schließen' }).click();
    await page.locator('#vmini canvas').click({ position: { x: 20, y: 20 } });
    await promptAction(() => page.keyboard.press('v'), 'Mini');
    assert(await page.locator('#vmini-flight-recorder .jo3dflight-go').count() === 1 &&
        await page.locator('#mviewer-flight-recorder .jo3dflight-go').count() === 1, 'V records only the focused viewer');
    await page.locator('#mviewer').evaluate(v => v.dataset.flightRecorder = 'hidden');
    assert(!await page.locator('#mviewer .jo3dviewport-button').isVisible(), 'HTML hidden switch');
    await page.locator('#mviewer').evaluate(v => v.dataset.flightRecorder = 'visible');
    assert(await page.locator('#mviewer .jo3dviewport-button').isVisible(), 'HTML visible switch');
    assert(errors.length === 0, errors.join('\n'));
    await page.unrouteAll({ behavior: 'wait' });
    return { result: 'Recording, Info, flight, JSONL round trip, errors, cancellation, layout, keyboard, isolation and cleanup passed', flightChecks };
}
