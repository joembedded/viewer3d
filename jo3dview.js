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

    if (backimg === undefined) {
        const bkTexture = createCanvasTexture('#ffffff', '#202030');
        bkTexture.mapping = THREE.EquirectangularReflectionMapping;
        data3d.scene.environment = bkTexture;
        backgroundTexture = bkTexture;
        data3d.scene.background = new THREE.Color(0x202028); // better
    } else {
        const bkTexture = new THREE.TextureLoader().load(backimg, (texture) => {
            if (disposed) texture.dispose();
            else data3d.invalidate();
        }, undefined, () => {
            if (disposed) return;
            // A missing panorama must not turn metallic models black.
            bkTexture.dispose();
            data3d.panorama = undefined;
            backgroundTexture = createCanvasTexture('#ffffff', '#303039');
            backgroundTexture.mapping = THREE.EquirectangularReflectionMapping;
            data3d.scene.environment = backgroundTexture;
            data3d.scene.background = new THREE.Color(0x202830);
            data3d.invalidate();
            options.onBackgroundError?.();
        });
        backgroundTexture = bkTexture;
        data3d.panorama = bkTexture;
        bkTexture.colorSpace = THREE.SRGBColorSpace;
        bkTexture.mapping = THREE.EquirectangularReflectionMapping;
        data3d.scene.environment = bkTexture;
        data3d.scene.background = bkTexture;
    }

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
    let visible = true;
    const visibilityObserver = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        data3d.invalidate();
    });
    visibilityObserver.observe(data3d.container);
    // Animation loop
    function animate(time) {
        const dt = Math.min((time - (previousTime ?? time)) / 1000, 0.1);
        previousTime = time;
        if (disposed || document.hidden || !visible) return;
        if (!interacting && resumeRotationAt !== null && time >= resumeRotationAt) {
            data3d.controls.autoRotate = true;
            data3d.rotationPaused = false;
            resumeRotationAt = null;
        }
        if (data3d.modelscale !== undefined) {
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
            data3d.renderer.render(data3d.scene, data3d.camera);
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
        data3d.controls.dispose();
        if (data3d.model) releaseModel(data3d.model);
        backgroundTexture?.dispose();
        data3d.renderer.dispose();
        data3d.renderer.domElement.remove();
    };
    // data3d contains ALL variables to control the 3D view
    return data3d;
}
// ***

/** Recommended documentation preset; original view3d() remains available.
 * Call dispose() when removing the viewer, and invalidate() after manual scene edits.
 */
export function view3dDocumentation(containerId, {
    model = './testball-optimized.glb', background = './southern-germany.webp',
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
    viewer.controls.minDistance = size * 0.77;
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
        viewer.scene.background = enabled || !viewer.panorama ? new THREE.Color('#303941') : viewer.panorama;
        viewer.pauseAutoRotate();
        viewer.invalidate();
    };
    viewer.resetView = () => { viewer.pauseAutoRotate(); viewer.controls.reset(); viewer.invalidate(); };
    if (toolbar) {
        toolbar.classList.add('jo3dtoolbar');
        rotationButton = button('Drehung an', () => viewer.setAutoRotate(!rotationEnabled));
        viewer.setAutoRotate(rotationEnabled);
        const neutralButton = button('Neutraler Hintergrund', () => {
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
