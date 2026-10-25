// Run with: playwright-cli -s=presentation run-code --filename=tools/check-flight-presentation.js
async (page) => {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/scientific-logger.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace(
            'const viewer = view3dDocumentation(', 'const viewer = window.__viewer = view3dDocumentation('
        ).replace("model: './models/Rundlogger.glb',", "transTime: 0.1, model: './models/Rundlogger.glb',") });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost/viewer3d/scientific-logger.html');
    await page.evaluate(() => window.__viewer.ready.then(() => undefined));
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    const panel = page.getByRole('dialog');
    const box = page.locator('.jo3dflight-info');
    const prompt = async (action, reply) => {
        await page.evaluate(reply => { window.prompt = (message, value) => { window.__promptDefault = value; return reply; }; }, reply);
        await action();
    };
    const record = name => prompt(() => panel.getByRole('button', { name: 'View loggen', exact: true }).click(), name);
    const settle = () => page.evaluate(async () => {
        for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
    });
    await page.locator('#mviewer canvas').hover({ position: { x: 150, y: 100 } });
    await page.mouse.wheel(0, -500); await settle(); await record('Nah');
    await page.locator('#mviewer canvas').hover({ position: { x: 150, y: 100 } });
    await page.mouse.wheel(0, 1000); await settle(); await record('Fern');
    await page.evaluate(() => {
        const v = window.__viewer;
        v.camera.zoom = 1.6; v.camera.updateProjectionMatrix(); v.invalidate();
    });
    await record('Details');
    const edit = panel.locator('.jo3dflight-point').first().getByRole('button', { name: 'Edit', exact: true });
    await prompt(() => edit.click(), null);
    assert(await page.evaluate(() => window.__promptDefault) === 'Nah-YourCommentsHere', 'Edit offers old Info value');
    assert(await panel.getByRole('textbox').first().inputValue() === 'Nah-YourCommentsHere', 'cancel preserves Info');
    await prompt(() => edit.click(), 'Anschlüsse\\n<em>Kein HTML</em>');
    await prompt(() => panel.locator('.jo3dflight-point').nth(1).getByRole('button', { name: 'Edit', exact: true }).click(), 'Übersicht\nAbstand');
    const points = await page.evaluate(() => window.__viewer.flightRecorder.points);
    assert(points[1].camera.distance > points[0].camera.distance * 1.3 && points[2].camera.zoom === 1.6,
        'wheel distance and optical zoom both recorded');
    assert(await panel.locator('.jo3dflight-zoom').count() === 3, 'zoom and distance shown in list');
    const arrived = async index => {
        await page.waitForFunction(index => !window.__viewer.flightRecorder.isFlying &&
            window.__viewer.flightRecorder.currentIndex === index &&
            Number(getComputedStyle(window.__viewer.flightRecorder.infoBox).opacity) > .99, index);
        const pose = await page.evaluate(() => {
            const v = window.__viewer;
            return { distance: v.camera.position.distanceTo(v.controls.target), zoom: v.camera.zoom,
                projectedScale: v.camera.projectionMatrix.elements[5] };
        });
        const camera = points[index].camera;
        const expectedScale = camera.zoom / Math.tan(camera.fov * Math.PI / 360);
        assert(Math.abs(pose.distance - camera.distance) < 1e-8 && Math.abs(pose.zoom - camera.zoom) < 1e-8 &&
            Math.abs(pose.projectedScale - expectedScale) < 1e-8, 'recorded distance, zoom and projection restored for ' + index);
    };
    await panel.getByRole('button', { name: 'Nah', exact: true }).click(); await arrived(0);
    assert(await box.locator('p').textContent() === 'Anschlüsse\n<em>Kein HTML</em>' &&
        await box.locator('em').count() === 0, 'Info line break and safe text rendering');
    assert(await box.getByRole('button', { name: 'Vorherigen Punkt anfliegen' }).isDisabled(), 'previous disabled at first point');
    await page.screenshot({ path: 'output/playwright/flight-presentation-desktop.png' });
    await box.getByRole('button', { name: 'Nächsten Punkt anfliegen' }).click(); await arrived(1);
    assert(await box.locator('p').textContent() === 'Übersicht\nAbstand', 'real line breaks also render correctly');
    await box.getByRole('button', { name: 'Nächsten Punkt anfliegen' }).click(); await arrived(2);
    assert(await box.getByRole('button', { name: 'Nächsten Punkt anfliegen' }).isDisabled(), 'next disabled at last point');
    await box.getByRole('button', { name: 'Vorherigen Punkt anfliegen' }).click(); await arrived(1);
    await box.getByRole('button', { name: 'START – Startpunkt anfliegen' }).click(); await arrived(0);
    await prompt(() => edit.click(), 'Aktualisiert\nDirekt sichtbar');
    assert(await box.locator('p').textContent() === 'Aktualisiert\nDirekt sichtbar', 'Edit updates active presentation');
    await prompt(() => edit.click(), points[0].info);
    await page.setViewportSize({ width: 320, height: 568 });
    await panel.getByRole('button', { name: 'Flight Recorder schließen' }).click();
    await page.screenshot({ path: 'output/playwright/flight-presentation-mobile.png' });
    assert(await box.evaluate(b => {
        const r = b.getBoundingClientRect(), parent = b.parentElement.getBoundingClientRect();
        const nav = b.querySelector('nav').getBoundingClientRect();
        const launcher = b.parentElement.querySelector('.jo3dviewport-button').getBoundingClientRect();
        return r.left >= parent.left && r.right <= parent.right && r.top >= parent.top &&
            r.bottom <= parent.bottom && nav.bottom <= r.bottom && b.scrollWidth <= b.clientWidth && r.top >= launcher.bottom;
    }), 'Info box and four controls fit mobile viewer');
    await box.getByRole('button', { name: 'END – Präsentation beenden' }).click();
    await page.waitForFunction(() => window.__viewer.controls.autoRotate && !window.__viewer.flightRecorder.isFlying);
    await page.waitForFunction(() => getComputedStyle(window.__viewer.flightRecorder.infoBox).visibility === 'hidden');
    assert(await page.evaluate(() => window.__viewer.controls.autoRotate && !window.__viewer.flightRecorder.isPresenting &&
        window.__viewer.flightRecorder.infoBox.inert), 'END hides box and resumes rotation');

    // Download and re-load the actual recorded wheel and projection zoom values.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Export', exact: true }).click();
    await (await downloadPromise).saveAs('output/playwright/presentation-roundtrip.jsonl');
    await panel.getByRole('button', { name: 'Reset', exact: true }).click();
    await prompt(() => panel.getByRole('button', { name: 'Laden', exact: true }).click(), 'output/playwright/presentation-roundtrip.jsonl');
    await page.waitForFunction(() => window.__viewer.flightRecorder.points.length === 3);
    await panel.getByRole('button', { name: 'Details', exact: true }).click(); await arrived(2);
    await panel.getByRole('button', { name: 'Nah', exact: true }).click(); await arrived(0);
    const compatibility = await page.evaluate(async () => {
        const v = window.__viewer, r = v.flightRecorder;
        const { parseFlightPoints, TRANSTIME } = await import('./driver_js/flight-recorder.js');
        const old = structuredClone(r.points[0]); delete old.camera.distance;
        const legacy = parseFlightPoints(JSON.stringify(old))[0];
        const derived = Math.abs(legacy.camera.distance - r.points[0].camera.distance) < 1e-8;
        const changed = structuredClone(r.points[0]); changed.camera.distance *= 1.5;
        v.renderer.setAnimationLoop(null);
        r.flyTo(changed);
        const hiddenDuringFlight = r.infoBox.inert && !r.infoBox.classList.contains('is-visible');
        r.update(1000);
        const changedDistance = Math.abs(v.camera.position.distanceTo(v.controls.target) - changed.camera.distance) < 1e-8;
        r.reset();
        const resetHides = r.infoBox.inert;
        v.dispose();
        const disposed = !document.querySelector('.jo3dflight-info');
        return { derived, hiddenDuringFlight, changedDistance, resetHides, disposed, TRANSTIME };
    });
    assert(compatibility.derived && compatibility.hiddenDuringFlight && compatibility.changedDistance &&
        compatibility.resetHides && compatibility.disposed && compatibility.TRANSTIME === 2,
        'old files, editable distance, speed and cleanup: ' + JSON.stringify(compatibility));
    assert(errors.length === 0, errors.join('\n'));
    await page.unrouteAll({ behavior: 'wait' });
    return { result: 'Wheel zoom, optical zoom, JSONL round trip, Edit, Info, navigation and END passed',
        distances: points.map(p => p.camera.distance), zoom: points.map(p => p.camera.zoom), compatibility };
}
