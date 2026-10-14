async (page) => {
    const url='http://localhost/viewer3d/skybox-explorer.html';
    const errors=[]; const checks=[];
    page.on('pageerror', error=>errors.push(error.message));
    const assert=(value,message)=>{if(!value) throw new Error(message);};
    await page.route('**/skybox-explorer.html', async route=>{
        const response=await route.fetch();
        await route.fulfill({response,body:(await response.text()).replace(
            'const viewer = view3dDocumentation(', 'const viewer = window.__viewer = view3dDocumentation(')});
    });
    await page.goto(url);
    await page.evaluate(async()=>{
        await window.__viewer.ready; await window.__viewer.backgroundReady;
        window.__viewer.setAutoRotate(false);
        window.__viewer.controls.enableDamping=false;
        // Flush any pending orbit delta before recording the stationary camera.
        window.__viewer.controls.update();
    });
    const select=page.getByRole('combobox',{name:'Hintergrund'});
    const files=await select.locator('option').evaluateAll(options=>options.map(o=>o.value));
    assert(files.length===7,'Missing skybox choices');
    await page.waitForFunction(() => !document.getElementById('background-status').textContent.includes('geladen'));
    const identity=await page.evaluate(()=>({model:window.__viewer.model.uuid,
        camera:window.__viewer.camera.position.toArray()}));
    for (const file of files) {
        await select.selectOption(file);
        assert(await page.evaluate(()=>window.__viewer.backgroundReady),'Background failed: '+file);
        await page.waitForFunction(()=>!document.getElementById('background-status').textContent.includes('geladen'));
        assert(await page.evaluate(id=>window.__viewer.model.uuid===id.model &&
            window.__viewer.camera.position.toArray().every((v,i)=>Math.abs(v-id.camera[i])<1e-6),identity),
            'Switch changed model/camera: '+file);
        if(file.endsWith('.mp4')) {
            await page.waitForFunction(()=>window.__viewer.backgroundVideo.currentTime>0.1);
            assert(await page.evaluate(()=>window.__viewer.scene.environment.isCanvasTexture &&
                window.__viewer.scene.environment.image.width===1024),'Video first-frame environment missing');
        } else assert(await page.evaluate(name=>window.__viewer.scene.environment.image.src.endsWith(name),file),
            'Wrong environment: '+file);
        await page.screenshot({path:'output/playwright/choice-'+file.replace(/\W/g,'-')+'.png'});
    }
    checks.push('All 7 choices load; model and camera preserved; video uses a captured frame');
    await select.selectOption('industrial_skybox.mp4');
    await page.evaluate(()=>window.__viewer.backgroundReady);
    const start=await page.evaluate(()=>({version:window.__viewer.panorama.version,env:window.__viewer.scene.environment.uuid}));
    await page.waitForFunction(n=>window.__viewer.panorama.version>n+4,start.version);
    assert(await page.evaluate(id=>window.__viewer.scene.environment.uuid===id,start.env),'Environment is not static');
    await page.evaluate(()=>{const v=window.__viewer.backgroundVideo;v.currentTime=v.duration-0.2;});
    await page.waitForFunction(()=>window.__viewer.backgroundVideo.currentTime<1.5);
    await page.getByRole('button',{name:'Neutraler Hintergrund'}).click();
    await page.waitForFunction(()=>window.__viewer.backgroundVideo.paused);
    await select.selectOption('southern-germany.webp');
    await page.evaluate(()=>window.__viewer.backgroundReady);
    assert(await page.getByRole('button',{name:'Neutraler Hintergrund'}).getAttribute('aria-pressed')==='false',
        'Neutral button state did not reset');
    checks.push('Stationary playback, static reflections, looping, neutral toggle and video-to-image switching');
    // Deliberately fail frame extraction: the automatic uppercase PNG path must load.
    await page.evaluate(async()=>{
        const original=CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData=function(...args){
            if(this.canvas.width===1024) throw new DOMException('Simulated blocked capture','SecurityError');
            return original.apply(this,args);
        };
        try {await window.__viewer.setBackground('./skyboxes/industrial_skybox.mp4', {
            environmentFallbackImage: undefined // Exercise inference, not the page's explicit companion image.
        });}
        finally {CanvasRenderingContext2D.prototype.getImageData=original;}
    });
    await page.waitForFunction(()=>window.__viewer.scene.environment.image.src?.endsWith('industrial_skybox.PNG'));
    checks.push('Blocked frame capture automatically loads matching .PNG');
    const videoHandle=await page.evaluateHandle(()=>window.__viewer.backgroundVideo);
    await select.selectOption('joembeddedlab.webp'); await page.evaluate(()=>window.__viewer.backgroundReady);
    assert(await videoHandle.evaluate(v=>v.paused&&!v.getAttribute('src')),'Old video source not released');
    let delayed;
    await page.route('**/ScientificLab.png?slow=1',route=>{delayed=route;});
    const requested=page.waitForRequest('**/ScientificLab.png?slow=1');
    await page.evaluate(()=>{window.__slow=window.__viewer.setBackground('./skyboxes/ScientificLab.png?slow=1');});
    await requested;
    await select.selectOption('industrial_skybox.mp4'); await page.evaluate(()=>window.__viewer.backgroundReady);
    await select.selectOption('southern-germany.webp'); await page.evaluate(()=>window.__viewer.backgroundReady);
    await delayed.continue();
    assert(await page.evaluate(()=>window.__slow)===false,'Stale load should resolve false');
    assert(await page.evaluate(()=>window.__viewer.scene.environment.image.src.endsWith('southern-germany.webp')),
        'Late response overwrote selected image');
    checks.push('Old decoder released; delayed old image cannot overwrite newer selection');
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'output/playwright/selector-mobile.png'});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile horizontal overflow');
    await select.selectOption('industrial_skybox.mp4');await page.evaluate(()=>window.__viewer.backgroundReady);
    await page.evaluate(()=>{window.__viewer.container.style.display='none';});
    await page.waitForFunction(()=>window.__viewer.backgroundVideo.paused);
    await page.evaluate(()=>{window.__viewer.container.style.display='';});
    await page.waitForFunction(()=>!window.__viewer.backgroundVideo.paused);
    assert(await page.evaluate(()=>{const v=window.__viewer;v.dispose();v.dispose();return v.backgroundVideo.paused&&
        !v.backgroundVideo.getAttribute('src')&&!v.container.querySelector('canvas');}),'Dispose failed');
    checks.push('Mobile layout, hidden-view pause/resume and idempotent disposal');
    for (const name of ['jpiot-pcb.html','scientific-logger.html']) {
        await page.goto('http://localhost/viewer3d/'+name);
        await page.locator('#mloader').waitFor({state:'hidden'});
    }
    assert(errors.length===0,errors.join('\n'));
    checks.push('Legacy image viewers load without JavaScript errors');
    await page.unroute('**/skybox-explorer.html');
    await page.setViewportSize({width:1440,height:900});
    await page.goto(url);
    return checks;
}
