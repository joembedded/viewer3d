// Run with: playwright-cli -s=viewer run-code --filename=tools/check-model-rotation.js
async (page) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const assert = (value, message) => { if (!value) throw new Error(message); };
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.route('**/scientific-logger.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace(
            'const viewer = view3dDocumentation(', 'const viewer = window.__viewer = view3dDocumentation('
        ).replace('autoRotatePause: 10', 'autoRotatePause: 0.1') });
    });
    await page.goto('http://localhost/viewer3d/scientific-logger.html');
    await page.evaluate(() => window.__viewer.ready);
    const result = await page.evaluate(async () => {
        const v = window.__viewer;
        const frames = async (count = 12) => {
            for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
        };
        const measure = async () => {
            await frames(2);
            const start = performance.now(), angle = v.model.rotation.x;
            await frames(20);
            return { delta: v.model.rotation.x - angle, seconds: (performance.now() - start) / 1000 };
        };
        const moving = await measure();
        v.setAutoRotate(false);
        const stopped = await measure();
        v.setAutoRotate(true);
        const resumed = await measure();
        v.controls.dispatchEvent({ type: 'start' });
        const interacting = await measure();
        v.controls.dispatchEvent({ type: 'end' });
        while (!v.controls.autoRotate) await frames(2);
        const afterInteraction = await measure();
        v.container.style.display = 'none';
        await frames();
        const hidden = await measure();
        v.container.style.display = '';
        await frames();
        const shown = await measure();
        return { moving, stopped, resumed, interacting, afterInteraction, hidden, shown,
            tilt: v.model.rotation.z, speed: v.controls.autoRotateSpeed };
    });
    const expected = 2 * Math.PI / 60 * result.speed * 0.5;
    for (const name of ['moving', 'resumed', 'afterInteraction', 'shown']) {
        const measured = result[name].delta / result[name].seconds;
        assert(Math.abs(measured - expected) < Math.abs(expected) * 0.15,
            name + ': wrong model speed: ' + measured);
    }
    for (const name of ['stopped', 'interacting', 'hidden']) {
        assert(Math.abs(result[name].delta) < 1e-8, name + ': model kept spinning');
    }
    assert(Math.abs(result.tilt - Math.PI / 15) < 1e-8, 'Initial 12-degree tilt changed');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.evaluate(() => window.__viewer.ready);
    assert(await page.evaluate(() => !window.__viewer.controls.autoRotate &&
        window.__viewer.model.rotation.x === 0), 'Reduced motion did not disable model rotation');
    // The option is absent in this existing viewer: its model must stay fixed.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.route('**/material-preview.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace(
            'const viewer = view3dDocumentation(', 'const viewer = window.__viewer = view3dDocumentation(') });
    });
    await page.goto('http://localhost/viewer3d/material-preview.html');
    assert(await page.evaluate(async () => {
        const v = window.__viewer;
        await v.ready;
        const before = v.model.quaternion.clone();
        for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
        return before.equals(v.model.quaternion);
    }), 'Default viewer gained model rotation');
    await page.route('**/skybox-explorer.html', async route => {
        const response = await route.fetch();
        // Exercise all axes with a fixed fixture, independent of the demo's chosen speeds.
        await route.fulfill({ response, body: (await response.text()).replace(
            'const viewer = view3dDocumentation(', 'const viewer = window.__viewer = view3dDocumentation('
        ).replace(/modelAutoRotateSpeed:\s*\[[^\]]*\]/, 'modelAutoRotateSpeed: [2, 0.5, 0.35]') });
    });
    await page.goto('http://localhost/viewer3d/skybox-explorer.html');
    const vector = await page.evaluate(async () => {
        const v = window.__viewer;
        await v.ready;
        const axes = ['x', 'y', 'z'];
        const angles = () => axes.map(axis => v.model.rotation[axis]);
        const frames = async () => {
            for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
        };
        await frames();
        const start = performance.now(), before = angles();
        await frames();
        const seconds = (performance.now() - start) / 1000;
        const speeds = angles().map((angle, i) =>
            Math.atan2(Math.sin(angle - before[i]), Math.cos(angle - before[i])) / seconds);
        v.setAutoRotate(false);
        const paused = angles();
        await frames();
        return { speeds, stopped: angles().every((angle, i) => Math.abs(angle - paused[i]) < 1e-8) };
    });
    [2, 0.5, 0.35].forEach((speed, i) => {
        const expected = 2 * Math.PI / 60 * speed;
        assert(Math.abs(vector.speeds[i] - expected) < expected * 0.15,
            'Wrong vector rotation speed on axis ' + i);
    });
    assert(vector.stopped, 'Vector rotation did not stop on all axes');
    await page.unroute('**/scientific-logger.html');
    await page.unroute('**/material-preview.html');
    await page.unroute('**/skybox-explorer.html');
    await page.goto('http://localhost/viewer3d/skybox-explorer.html');
    assert(errors.length === 0, errors.join('\n'));
    return { checks: 'XYZ vector speeds, half-speed X rotation, toggle, interaction pause/resume, visibility, tilt, reduced motion and disabled default passed', result, vector };
}
