// Run with: playwright-cli -s=return-home run-code --filename=tools/check-return-home.js
async (page) => {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/jpiot-pcb.html', async route => {
        const response = await route.fetch();
        const body = (await response.text())
            .replace('const d3img2 = view3d(', 'const d3img2 = window.__viewer = view3d(')
            .replace('d3img2.controls.update();', `d3img2.controls.update();
                window.__homeCamera = d3img2.getViewport().camera;
                d3img2.ready.then(() => { window.__homeScale = d3img2.targetscale; });`);
        await route.fulfill({ response, body });
    });
    await page.goto('http://localhost/viewer3d/jpiot-pcb.html');
    await page.evaluate(() => window.__viewer.ready.then(() => undefined));
    // Change the view before starting: home must remain the app's startup pose.
    await page.evaluate(() => {
        const v = window.__viewer;
        v.setAutoRotate(false);
        v.camera.position.set(2, -1, 1); v.camera.zoom = 1.7;
        v.controls.target.set(.1, .2, 0); v.controls.update(0);
    });
    await page.getByRole('button', { name: 'Presentation', exact: true }).click();
    await page.waitForFunction(() => window.__viewer.flightRecorder.currentIndex === 0);
    // Observe actual animation frames, including the exact arrival frame before rotation.
    await page.evaluate(() => {
        const v = window.__viewer, r = v.flightRecorder, original = r.update;
        window.__returnFrames = [];
        r.update = dt => {
            const wasFlying = r.isFlying, autoBefore = v.controls.autoRotate;
            const result = original(dt);
            if (wasFlying) window.__returnFrames.push({ autoBefore, flying: r.isFlying,
                autoAfter: v.controls.autoRotate, pose: v.getViewport() });
            return result;
        };
    });
    await page.getByRole('button', { name: 'END – Präsentation beenden' }).click();
    await page.waitForFunction(() => window.__viewer.controls.autoRotate && !window.__viewer.flightRecorder.isFlying);
    const actual = await page.evaluate(() => ({ frames: window.__returnFrames, camera: window.__homeCamera,
        scale: window.__homeScale, hidden: window.__viewer.flightRecorder.infoBox.inert }));
    const frames = actual.frames, last = frames.at(-1);
    const close = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-8);
    assert(frames.length > 2 && frames.every(f => !f.autoBefore) &&
        frames.slice(0, -1).every(f => f.flying && !f.autoAfter) && !last.flying && last.autoAfter,
        'autorotation begins only on arrival');
    for (const key of ['position', 'target', 'quaternion', 'up'])
        assert(close(last.pose.camera[key], actual.camera[key]), 'startup camera ' + key);
    for (const key of ['zoom', 'distance', 'fov'])
        assert(Math.abs(last.pose.camera[key] - actual.camera[key]) < 1e-8, 'startup camera ' + key);
    assert(close(last.pose.model.quaternion, [0, 0, 0, 1]) &&
        close(last.pose.model.scale, Array(3).fill(actual.scale)) && actual.hidden,
        'original model pose and final intro scale restored, info hidden');
    assert(await page.evaluate(async () => {
        const v = window.__viewer, before = v.camera.position.clone();
        for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
        return v.controls.autoRotate && before.distanceTo(v.camera.position) > 1e-6;
    }), 'rotation visibly continues after returning');
    const interruptions = await page.evaluate(() => {
        const v = window.__viewer, r = v.flightRecorder;
        v.renderer.setAnimationLoop(null);
        const results = [];
        for (const interrupt of [() => r.stop(), () => r.flyTo(1),
            () => v.controls.dispatchEvent({ type: 'start' }), () => r.reset()]) {
            const duration = r.startAutoRotation();
            r.update(duration / 3);
            interrupt(); r.update(1000);
            results.push(!v.controls.autoRotate && !r.isFlying);
        }
        r.startAutoRotation(); r.update(1000);
        results.push(v.controls.autoRotate && !r.isPresenting);
        v.dispose();
        return results;
    });
    assert(interruptions.every(Boolean), 'stop, new flight, manual input and Reset cancel delayed rotation');
    assert(errors.length === 0, errors.join('\n'));
    await page.unrouteAll({ behavior: 'wait' });
    return { result: 'END returns to startup camera/model/zoom, then rotates; interruption and Auto after Reset passed', frames: frames.length };
}
