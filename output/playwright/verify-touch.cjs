async (page) => {
    await page.evaluate(async () => {
        const { view3dDocumentation } = await import('/jo3dview.js?v=20261011-realism');
        const host = document.createElement('div');
        host.id = 'qa-touch';
        host.style = 'position:fixed;left:30px;top:120px;width:600px;height:400px;z-index:100';
        document.body.appendChild(host);
        window.qaTouch = view3dDocumentation(host.id);
        await qaTouch.ready;
    });
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const touch = (type, points) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await touch('touchStart', [{ x:250, y:250, id:1 }]);
    await touch('touchMove', [{ x:290, y:270, id:1 }]);
    if (!await page.evaluate(() => qaTouch.rotationPaused && !qaTouch.controls.autoRotate)) throw new Error('Touch drag pause failed');
    await touch('touchEnd', []);
    await touch('touchStart', [{x:200,y:250,id:1},{x:350,y:250,id:2}]);
    await touch('touchMove', [{x:170,y:250,id:1},{x:380,y:250,id:2}]);
    await touch('touchEnd', []);
    if (!await page.evaluate(() => qaTouch.rotationPaused && !qaTouch.controls.autoRotate)) throw new Error('Pinch pause failed');
    await page.evaluate(() => { qaTouch.dispose(); document.getElementById('qa-touch').remove(); });
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await session.detach();
    return 'PASS: touch drag and two-finger zoom pause automatic rotation';
}
