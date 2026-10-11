async (page) => {
    const check = (ok, label) => { if (!ok) throw new Error(label); };
    await page.evaluate(async () => {
        const { view3dDocumentation } = await import('/jo3dview.js?v=20261011-realism');
        const host = document.createElement('div');
        host.id = 'qa-viewer';
        host.style = 'position:fixed;inset:120px auto auto 30px;width:600px;height:400px;z-index:100';
        document.body.appendChild(host);
        window.qaViewer = view3dDocumentation(host.id, { model:'/testball-optimized.glb', background:'/southern-germany.webp' });
        await window.qaViewer.ready;
    });
    const state = () => page.evaluate(() => ({
        rotating: qaViewer.controls.autoRotate, paused: qaViewer.rotationPaused,
        position: qaViewer.camera.position.toArray(), frames: qaViewer.renderer.info.render.frame,
        textures: qaViewer.renderer.info.memory.textures
    }));
    const initial = await state();
    await page.waitForTimeout(400);
    check(JSON.stringify(initial.position) !== JSON.stringify((await state()).position), 'Automatic rotation must move');
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(370, 330, { steps: 8 });
    check((await state()).paused && !(await state()).rotating, 'Drag must pause rotation');
    await page.mouse.up();
    await page.waitForTimeout(5300);
    check((await state()).paused, 'Rotation must remain paused at 5 seconds');
    await page.mouse.wheel(0, 80);
    await page.waitForTimeout(5500);
    check((await state()).paused, 'Repeated interaction must restart the 10 second delay');
    await page.waitForTimeout(4800);
    check((await state()).rotating && !(await state()).paused, 'Rotation must resume after 10 seconds');
    await page.evaluate(() => qaViewer.setAutoRotate(false));
    // OrbitControls damping settles over frames (also on software WebGL).
    for (let attempt = 0; attempt < 20; attempt++) {
        const before = (await state()).frames;
        await page.waitForTimeout(500);
        if (before === (await state()).frames) break;
    }
    const idle = await state();
    await page.waitForTimeout(500);
    check(idle.frames === (await state()).frames, 'Static viewer should not render GPU frames');
    await page.mouse.wheel(0, -80);
    check(!(await state()).paused && !(await state()).rotating, 'Manual stop must remain off after interaction');
    await page.evaluate(() => qaViewer.dispose());
    check(await page.locator('#qa-viewer canvas').count() === 0, 'Dispose must remove canvas');
    await page.evaluate(() => document.getElementById('qa-viewer').remove());
    return { result: 'PASS: rotation, drag pause, wheel restart, 10-second resume, manual stop, idle rendering, disposal', initial, idle };
}
