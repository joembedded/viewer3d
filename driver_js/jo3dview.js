/* jo3dview.js - V1.05 2026 (C) JoEmbedded.de - 3D Viewer Module */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The optional seventh argument enables documentation presets without changing legacy demos.
export function view3d(containerId, modelFname, tscale = 1, loaderId = undefined, backimg = undefined, shift2org = true, options = {}) {
    const data3d = {
        container: document.getElementById(containerId),
        scene: new THREE.Scene()
    }
    if (!data3d.container) throw new Error(`Viewer container not found: ${containerId}`);
    let disposed = false;
    let dirty = true;
    let previousTime;
    let backgroundTexture;
    let backgroundRequest = 0;
    let videoSkybox;
    let visible = true;
    // Same units as OrbitControls.autoRotateSpeed: 1 = one turn per 60 seconds.
    // Per-axis [x, y, z] speeds; accept the original scalar as an X-only speed.
    const rotationSpeeds = Array.isArray(options.modelAutoRotateSpeed)
        ? options.modelAutoRotateSpeed : [options.modelAutoRotateSpeed];
    const modelAutoRotateSpeed = [0, 1, 2].map(i =>
        Number.isFinite(rotationSpeeds[i]) ? rotationSpeeds[i] : 0);
    const modelAutoRotateEnabled = modelAutoRotateSpeed.some(speed => speed !== 0);
    data3d.invalidate = () => { dirty = true; };
    let resolveReady, rejectReady;
    data3d.ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // Existing callers use the loader label; integrations can also await ready.
    data3d.ready.catch(() => {});
    // Funktion: Erzeuge kline einfarbiges Canvas Textur
    function createCanvasTexture(colorTop, colorBottom) {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        // Farbverlauf (oben -> unten)
        const gradient = context.createLinearGradient(0, 0, 0, size);
        gradient.addColorStop(0, colorTop);
        gradient.addColorStop(1, colorBottom);
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    // Retain a small neutral environment while media loads or fails.
    const fallbackTexture = createCanvasTexture('#ffffff', '#202030');
    fallbackTexture.mapping = THREE.EquirectangularReflectionMapping;
    data3d.scene.environment = fallbackTexture;
    data3d.scene.background = new THREE.Color(0x202830);

    data3d.camera = new THREE.PerspectiveCamera(30, data3d.container.clientWidth / data3d.container.clientHeight, 0.1, 1000);
    data3d.camera.position.set(0, 2, 0.5);
    data3d.renderer = new THREE.WebGLRenderer({ antialias: true });
    data3d.renderer.setAnimationLoop(animate);
    data3d.renderer.outputColorSpace = THREE.SRGBColorSpace;
    data3d.renderer.toneMappingExposure = 1.2;
    data3d.renderer.toneMapping = THREE.LinearToneMapping;
    data3d.renderer.toneMapping = options.toneMapping ?? data3d.renderer.toneMapping;
    data3d.renderer.toneMappingExposure = options.exposure ?? data3d.renderer.toneMappingExposure;
    data3d.scene.backgroundIntensity = options.backgroundIntensity ?? 1;
    data3d.scene.environmentIntensity = options.environmentIntensity ?? 1;
    data3d.scene.backgroundBlurriness = options.backgroundBlurriness ?? 0;
    // Switch only the environment: keep the model, camera, controls and WebGL context.
    data3d.setBackground = (source, backgroundOptions = {}) => {
        if (disposed) return Promise.resolve(false);
        const request = ++backgroundRequest;
        videoSkybox?.dispose();
        videoSkybox = undefined;
        backgroundTexture?.dispose();
        backgroundTexture = undefined;
        data3d.panorama = undefined;
        data3d.backgroundVideo = undefined;
        data3d.scene.environment = fallbackTexture;
        data3d.scene.background = new THREE.Color(0x202830);
        const settings = { ...options, ...backgroundOptions };
        const isVideo = typeof source === 'string' && /\.mp4(?:[?#]|$)/i.test(source);
        let ready;
        if (isVideo) {
            videoSkybox = createVideoSkybox(data3d, source, settings);
            videoSkybox.setVisible(visible && !document.hidden);
            videoSkybox.resize(Math.max(1, data3d.container.clientWidth), Math.max(1, data3d.container.clientHeight));
            ready = videoSkybox.ready;
        } else if (source !== undefined) {
            ready = new Promise(resolve => {
                const texture = new THREE.TextureLoader().load(source, () => {
                    if (disposed || request !== backgroundRequest) { texture.dispose(); resolve(false); return; }
                    data3d.panorama = texture;
                    data3d.scene.environment = texture;
                    if (!data3d.neutralBackground) data3d.scene.background = texture;
                    data3d.invalidate();
                    resolve(true);
                }, undefined, error => {
                    texture.dispose();
                    if (!disposed && request === backgroundRequest) settings.onBackgroundError?.(error);
                    resolve(false);
                });
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.mapping = THREE.EquirectangularReflectionMapping;
                backgroundTexture = texture;
            });
        } else ready = Promise.resolve(true);
        if (data3d.neutralBackground) data3d.scene.background = new THREE.Color('#303941');
        data3d.invalidate();
        data3d.backgroundReady = ready;
        return ready;
    };
    data3d.setBackground(backimg);
    data3d.container.appendChild(data3d.renderer.domElement);
    function resizeViewer() {
        const width = Math.max(1, data3d.container.clientWidth);
        const height = Math.max(1, data3d.container.clientHeight);
        // Cap GPU work on high-density phones; CSS fills the exact inner border.
        const pixelBudget = options.maxPixels ?? Infinity;
        data3d.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,
            options.maxPixelRatio ?? 2, Math.sqrt(pixelBudget / (width * height))));
        data3d.renderer.setSize(width, height, false);
        data3d.camera.aspect = width / height;
        // Allow extra horizontal room in portrait for the rotating PCB's diagonal.
        data3d.camera.fov = Math.min(110, THREE.MathUtils.radToDeg(2 * Math.atan(
            Math.tan(THREE.MathUtils.degToRad(options.fov ?? 30) / 2) /
            Math.min(1, width / height / (options.framingAspect ?? 1.35))
        )));
        data3d.camera.updateProjectionMatrix();
        videoSkybox?.resize(width, height);
        data3d.invalidate();
    }
    resizeViewer();
    data3d.resizeObserver = new ResizeObserver(resizeViewer);
    data3d.resizeObserver.observe(data3d.container);
    window.addEventListener('resize', resizeViewer);

    // GLTF/GLB laden
    data3d.modelscale = undefined; // set after full loaded!
    data3d.targetscale = tscale;
    const loader = new GLTFLoader();
    if (loaderId) {
        data3d.loaderDiv = document.getElementById(loaderId); // Loader per Model
        if (data3d.loaderDiv) data3d.loaderDiv.textContent = options.loadingText ?? 'Loading...';
    }
    loader.load(
        modelFname,
        (gltf) => {
            if (disposed) { releaseModel(gltf.scene); return; }
            data3d.model = gltf.scene;

            // Mittelpunkt berechnen und verschieben
            const box = new THREE.Box3().setFromObject(data3d.model);
            const center = new THREE.Vector3();
            box.getCenter(center);
            if (shift2org) {
                // Center the content inside a group so scaling and rotation also
                // transform the offset, rather than shifting the PCB off center.
                data3d.model.position.sub(center);
                const centeredModel = new THREE.Group();
                centeredModel.add(data3d.model);
                data3d.model = centeredModel;
            }
            // Modell skalieren, sodass es einigermassen den Viewer füllt
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z, Number.EPSILON);
            const desiredSize = tscale; /* Default-Size fürs Test-Model, kann man noch optimieren */
            data3d.targetscale = desiredSize / maxDim;
            data3d.modelscale = options.animateIntro === false ? data3d.targetscale : data3d.targetscale * 0.01;
            data3d.model.scale.setScalar(data3d.modelscale);
            data3d.scene.add(data3d.model);
            data3d.modRotTarget = new THREE.Vector3(0, 0, 0);
            if (options.animateIntro !== false) data3d.model.rotation.set(3.14, 1.7, 0.8);

            if (options.debug) console.debug('3D model:', modelFname, { size, center });
            if (data3d.loaderDiv) data3d.loaderDiv.style.display = 'none';
            data3d.invalidate();
            resolveReady(data3d);
        },
        (xhr) => {
            if (disposed) return;
            if (!xhr.total) return;
            let proc = (xhr.loaded / xhr.total * 100).toFixed(1);
            if (proc > 100) proc = 100;
            if (data3d.loaderDiv) data3d.loaderDiv.textContent = (proc < 100) ? `Loaded: ${proc}%` : `Init 3D...`;
        },
        (error) => {
            if (disposed) return;
            if (data3d.loaderDiv) data3d.loaderDiv.textContent = options.errorText ?? ('Load Error: ' + error);
            rejectReady(error);
        }
    );
    //  Controls - erst aktivieren wenn alles geladen
    data3d.controls = new OrbitControls(data3d.camera, data3d.renderer.domElement);
    data3d.controls.enableDamping = true;
    data3d.controls.autoRotate = options.autoRotate ?? true;
    data3d.controls.autoRotateSpeed = options.autoRotateSpeed ?? 0.1;
    data3d.controls.addEventListener('change', data3d.invalidate);
    let interacting = false;
    let resumeRotationAt = null;
    data3d.rotationPaused = false;
    data3d.setAutoRotate = (enabled) => {
        resumeRotationAt = null;
        data3d.rotationPaused = false;
        data3d.controls.autoRotate = Boolean(enabled);
        data3d.invalidate();
    };
    data3d.pauseAutoRotate = () => {
        if (!data3d.controls.autoRotate && !data3d.rotationPaused) return;
        data3d.rotationPaused = true;
        data3d.controls.autoRotate = false;
        resumeRotationAt = performance.now() + (options.autoRotatePause ?? 10) * 1000;
    };
    data3d.controls.addEventListener('start', () => {
        interacting = true;
        if (data3d.controls.autoRotate || data3d.rotationPaused) {
            data3d.rotationPaused = true;
            data3d.controls.autoRotate = false;
            resumeRotationAt = null;
        }
    });
    data3d.controls.addEventListener('end', () => {
        interacting = false;
        if (data3d.rotationPaused) resumeRotationAt = performance.now() + (options.autoRotatePause ?? 10) * 1000;
    });
    // Pause GPU work for documentation viewers outside the viewport or hidden tabs.
    const visibilityObserver = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        videoSkybox?.setVisible(visible && !document.hidden);
        data3d.invalidate();
    });
    visibilityObserver.observe(data3d.container);
    const visibilityChanged = () => {
        videoSkybox?.setVisible(visible && !document.hidden);
        data3d.invalidate();
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    // Animation loop
    function animate(time) {
        const dt = Math.min((time - (previousTime ?? time)) / 1000, 0.1);
        previousTime = time;
        if (disposed || document.hidden || !visible) return;
        if (videoSkybox?.update()) dirty = true;
        if (!interacting && resumeRotationAt !== null && time >= resumeRotationAt) {
            data3d.controls.autoRotate = true;
            data3d.rotationPaused = false;
            resumeRotationAt = null;
        }
        if (data3d.modelscale !== undefined) {
            if (modelAutoRotateEnabled && data3d.controls.autoRotate &&
                data3d.controls.enabled && !interacting) {
                // Move target and current angle together so pausing stops the
                // extra spin immediately, without a trailing interpolation.
                for (const [i, axis] of ['x', 'y', 'z'].entries()) {
                    if (modelAutoRotateSpeed[i] === 0) continue;
                    const step = (2 * Math.PI / 60) * modelAutoRotateSpeed[i] * dt;
                    const next = data3d.modRotTarget[axis] + step;
                    const wrapped = THREE.MathUtils.euclideanModulo(next + Math.PI, 2 * Math.PI) - Math.PI;
                    data3d.model.rotation[axis] += step + wrapped - next;
                    data3d.modRotTarget[axis] = wrapped;
                }
                dirty = true;
            }
            const changing = Math.abs(data3d.targetscale - data3d.modelscale) > 1e-6 ||
                ['x', 'y', 'z'].some(axis => Math.abs(data3d.modRotTarget[axis] - data3d.model.rotation[axis]) > 1e-6);
            dirty ||= changing;
            data3d.modelscale += (1 - Math.pow(0.75, dt * 60)) * (data3d.targetscale - data3d.modelscale);
            data3d.model.scale.setScalar(data3d.modelscale);
            data3d.model.rotation.x += (1 - Math.pow(0.85, dt * 60)) * (data3d.modRotTarget.x - data3d.model.rotation.x);
            data3d.model.rotation.y += (1 - Math.pow(0.88, dt * 60)) * (data3d.modRotTarget.y - data3d.model.rotation.y);
            data3d.model.rotation.z += (1 - Math.pow(0.9, dt * 60)) * (data3d.modRotTarget.z - data3d.model.rotation.z);
        }
        data3d.controls.update(dt);
        if (dirty || !options.renderOnDemand) {
            if (videoSkybox) videoSkybox.render();
            else data3d.renderer.render(data3d.scene, data3d.camera);
            dirty = false;
        }
    }
    function releaseModel(model) {
        const resources = new Set();
        model.traverse(object => {
            if (object.geometry) resources.add(object.geometry);
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.filter(Boolean).forEach(material => {
                resources.add(material);
                Object.values(material).filter(value => value?.isTexture).forEach(texture => resources.add(texture));
            });
        });
        resources.forEach(resource => resource.dispose());
    }
    data3d.dispose = () => {
        if (disposed) return;
        disposed = true;
        rejectReady(new Error('Viewer disposed'));
        data3d.renderer.setAnimationLoop(null);
        data3d.resizeObserver.disconnect();
        visibilityObserver.disconnect();
        window.removeEventListener('resize', resizeViewer);
        document.removeEventListener('visibilitychange', visibilityChanged);
        videoSkybox?.dispose();
        data3d.controls.dispose();
        if (data3d.model) releaseModel(data3d.model);
        backgroundTexture?.dispose();
        fallbackTexture.dispose();
        data3d.renderer.dispose();
        data3d.renderer.domElement.remove();
    };
    // data3d contains ALL variables to control the 3D view
    return data3d;
}
// ***

// Render video panoramas directly: Three's cached equirectangular cube maps
// would otherwise freeze the background on the first frame. Lighting uses a
// separate static image (or a single frame), avoiding per-frame PMREM work.
function createVideoSkybox(viewer, url, options) {
    const { scene, renderer, camera, container } = viewer;
    const fallbackEnvironment = scene.environment;
    const fallbackBackground = scene.background;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    viewer.backgroundVideo = video;
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Also serves as the public panorama handle for the neutral-background toggle.
    viewer.panorama = texture;
    scene.background = texture;
    const skyScene = new THREE.Scene();
    const skyCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 20);
    const geometry = new THREE.SphereGeometry(10, 64, 32);
    // Inward-facing sphere, aligned with Three's equirectangular reflection UVs.
    geometry.scale(-1, 1, 1);
    geometry.rotateY(Math.PI);
    const material = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false });
    const sphere = new THREE.Mesh(geometry, material);
    skyScene.add(sphere);
    let disposed = false, failed = false, visible = !document.hidden;
    let playPending = false, playBlocked = false;
    let showingVideo = true;
    let lastVersion = -1;
    let environmentTexture;
    let environmentPending = Boolean(options.environmentImage);
    let frameAttempted = false, fallbackAttempted = false;
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });

    function useEnvironment(environment) {
        environment.colorSpace = THREE.SRGBColorSpace;
        environment.mapping = THREE.EquirectangularReflectionMapping;
        environmentTexture = environment;
        scene.environment = environment;
        viewer.invalidate();
    }
    function loadFallbackImage() {
        if (disposed || environmentTexture || environmentPending || fallbackAttempted) return;
        fallbackAttempted = true;
        environmentPending = true;
        const source = options.environmentFallbackImage ?? url.replace(/\.mp4(?=[?#]|$)/i, '.PNG');
        const image = new THREE.TextureLoader().load(source, () => {
            environmentPending = false;
            if (disposed) { image.dispose(); return; }
            useEnvironment(image);
        }, undefined, () => {
            image.dispose();
            environmentPending = false; // Keep the neutral environment if both sources fail.
        });
    }
    function captureEnvironment() {
        if (disposed || environmentTexture || environmentPending || frameAttempted ||
            video.readyState < video.HAVE_CURRENT_DATA) return;
        frameAttempted = true;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(1024, video.videoWidth);
            canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth));
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            // Detect a tainted canvas before handing it to WebGL.
            context.getImageData(0, 0, 1, 1);
            useEnvironment(new THREE.CanvasTexture(canvas));
        } catch {
            loadFallbackImage();
        }
    }
    function onLoadedData() {
        if (disposed) return;
        captureEnvironment();
        viewer.invalidate();
        resolveReady(true);
    }
    if (options.environmentImage) {
        new THREE.TextureLoader().load(options.environmentImage, image => {
            environmentPending = false;
            if (disposed) { image.dispose(); return; }
            useEnvironment(image);
        }, undefined, () => {
            // If the optional still is missing, use the first available frame.
            environmentPending = false;
            if (failed) loadFallbackImage();
            viewer.invalidate();
        });
    }
    function play() {
        if (disposed || failed || !visible || !showingVideo || playPending || !video.paused) return;
        playPending = true;
        let interrupted = false;
        video.play().then(() => {
            playBlocked = false;
            if (disposed || !visible || !showingVideo) video.pause();
        }).catch(error => {
            // Muted inline autoplay normally works; retry on a real gesture if blocked.
            playBlocked = error.name === 'NotAllowedError';
            interrupted = error.name === 'AbortError';
        }).finally(() => {
            playPending = false;
            if (interrupted) play();
        });
    }
    function retryPlay() { if (playBlocked) play(); }
    function onError() {
        if (disposed || failed) return;
        failed = true;
        video.pause();
        viewer.panorama = undefined;
        scene.background = fallbackBackground;
        loadFallbackImage();
        viewer.invalidate();
        resolveReady(false);
        options.onBackgroundError?.(video.error);
    }
    video.addEventListener('error', onError);
    video.addEventListener('loadeddata', onLoadedData);
    container.addEventListener('pointerdown', retryPlay);
    container.addEventListener('keydown', retryPlay);
    video.src = url;
    play();

    return {
        ready,
        resize(width, height) {
            const aspect = width / height;
            const fov = THREE.MathUtils.degToRad(options.backgroundFov ?? 60);
            const maxFov = THREE.MathUtils.degToRad(options.maxBackgroundFov ?? 85);
            // Rectilinear projection, at most 85 degrees on either axis by default.
            // The model keeps its original camera/framing, including in portrait.
            skyCamera.aspect = aspect;
            skyCamera.fov = THREE.MathUtils.radToDeg(Math.min(maxFov,
                2 * Math.atan(Math.tan(fov / 2) / Math.min(1, aspect)),
                2 * Math.atan(Math.tan(maxFov / 2) / aspect)));
            skyCamera.updateProjectionMatrix();
        },
        setVisible(value) {
            visible = value;
            if (visible) play();
            else video.pause();
        },
        update() {
            const show = scene.background === texture;
            if (show !== showingVideo) {
                showingVideo = show;
                if (show) play();
                else video.pause();
            }
            if (failed || video.readyState < video.HAVE_CURRENT_DATA) return false;
            texture.update(); // Also supports browsers without requestVideoFrameCallback.
            captureEnvironment();
            const changed = texture.version !== lastVersion;
            lastVersion = texture.version;
            return showingVideo && changed;
        },
        render() {
            if (scene.background !== texture) { renderer.render(scene, camera); return; }
            const autoClear = renderer.autoClear;
            try {
                if (video.readyState >= video.HAVE_CURRENT_DATA) {
                    skyCamera.quaternion.copy(camera.quaternion);
                    sphere.rotation.copy(scene.backgroundRotation);
                    material.color.setScalar(scene.backgroundIntensity);
                    renderer.render(skyScene, skyCamera);
                    renderer.clearDepth();
                    renderer.autoClear = false;
                    scene.background = null;
                } else scene.background = fallbackBackground;
                renderer.render(scene, camera);
            } finally {
                scene.background = texture;
                renderer.autoClear = autoClear;
            }
        },
        dispose() {
            disposed = true;
            resolveReady(false);
            video.removeEventListener('error', onError);
            video.removeEventListener('loadeddata', onLoadedData);
            container.removeEventListener('pointerdown', retryPlay);
            container.removeEventListener('keydown', retryPlay);
            video.pause();
            texture.dispose(); // Cancels VideoTexture's frame callback, too.
            video.removeAttribute('src');
            video.load();
            geometry.dispose();
            material.dispose();
            environmentTexture?.dispose();
            scene.environment = fallbackEnvironment;
            scene.background = fallbackBackground;
            viewer.panorama = undefined;
        }
    };
}

/** Recommended documentation preset; original view3d() remains available.
 * Call dispose() when removing the viewer, and invalidate() after manual scene edits.
 */
export function view3dDocumentation(containerId, {
    model = './models/testball-optimized.glb', background = './skyboxes/southern-germany.webp',
    loaderId, toolbarId, size = 1.1, cameraPosition = [-0.85, 0.20, 1.65],
    ...options
} = {}) {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const viewer = view3d(containerId, model, size, loaderId, background, true, {
        fov: 48, framingAspect: 1,
        toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.05,
        backgroundIntensity: 0.85, environmentIntensity: 1.25,
        maxPixelRatio: 1.75, maxPixels: 3000000,
        autoRotate: !reducedMotion, autoRotateSpeed: -0.35,
        autoRotatePause: 10, animateIntro: false, renderOnDemand: true,
        loadingText: 'Modell wird geladen …',
        errorText: 'Modell konnte nicht geladen werden. Bitte die Seite neu laden.',
        ...options
    });
    viewer.camera.position.fromArray(cameraPosition);
    viewer.controls.enablePan = false;
    viewer.controls.minDistance = size * 0.5;
    viewer.controls.maxDistance = size * 5.5;
    viewer.controls.update();
    viewer.controls.saveState();
    const canvas = viewer.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D-Modell. Mit Maus oder Touch drehen und zoomen.');

    const toolbar = toolbarId ? document.getElementById(toolbarId) : null;
    const buttons = [];
    function button(label, action) {
        const element = document.createElement('button');
        element.type = 'button';
        element.textContent = label;
        element.addEventListener('click', action);
        toolbar.appendChild(element);
        buttons.push(element);
        return element;
    }
    let rotationEnabled = viewer.controls.autoRotate;
    let rotationButton;
    let neutralButton;
    const setAutoRotate = viewer.setAutoRotate;
    viewer.setAutoRotate = enabled => {
        rotationEnabled = Boolean(enabled);
        setAutoRotate(enabled);
        if (rotationButton) {
            rotationButton.setAttribute('aria-pressed', String(rotationEnabled));
            rotationButton.textContent = rotationEnabled ? 'Drehung an' : 'Drehung aus';
        }
    };
    viewer.setNeutralBackground = enabled => {
        // Illumination stays unchanged when hiding the panorama.
        viewer.neutralBackground = Boolean(enabled);
        neutralButton?.setAttribute('aria-pressed', String(Boolean(enabled)));
        viewer.scene.background = enabled || !viewer.panorama ? new THREE.Color('#303941') : viewer.panorama;
        viewer.pauseAutoRotate();
        viewer.invalidate();
    };
    viewer.resetView = () => { viewer.pauseAutoRotate(); viewer.controls.reset(); viewer.invalidate(); };
    if (toolbar) {
        toolbar.classList.add('jo3dtoolbar');
        rotationButton = button('Drehung an', () => viewer.setAutoRotate(!rotationEnabled));
        viewer.setAutoRotate(rotationEnabled);
        neutralButton = button('Neutraler Hintergrund', () => {
            const enabled = neutralButton.getAttribute('aria-pressed') !== 'true';
            neutralButton.setAttribute('aria-pressed', String(enabled));
            viewer.setNeutralBackground(enabled);
        });
        neutralButton.setAttribute('aria-pressed', 'false');
        button('Zurücksetzen', viewer.resetView);
    }
    const dispose = viewer.dispose;
    viewer.dispose = () => { buttons.forEach(element => element.remove()); dispose(); };
    return viewer;
}
