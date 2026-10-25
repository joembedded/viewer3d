import * as THREE from 'three';

// Base seconds per scene unit; long flights use square-root timing.
export const TRANSTIME = 2.0;

function validatePoint(value) {
    const fail = () => { throw new Error('Ungültiger Flugpunkt: Name oder Viewport-Daten fehlen bzw. sind ungültig.'); };
    const vector = (v, length) => {
        if (!Array.isArray(v) || v.length !== length || !v.every(Number.isFinite)) fail();
        return [...v];
    };
    const quaternion = v => {
        const values = vector(v, 4);
        const lengthSq = new THREE.Quaternion().fromArray(values).lengthSq();
        if (!Number.isFinite(lengthSq) || lengthSq < 1e-12) fail();
        // Preserve file values exactly across repeated load/export cycles.
        return values;
    };
    if (!value || value.version !== 1 || typeof value.name !== 'string' || !value.name.trim()) fail();
    const c = value.camera;
    if (!c || ![c.fov, c.zoom, c.near, c.far].every(Number.isFinite) ||
        c.fov <= 0 || c.fov >= 180 || c.zoom <= 0 || c.near <= 0 || c.far <= c.near) fail();
    const camera = {
        position: vector(c.position, 3), target: vector(c.target, 3), up: vector(c.up, 3),
        quaternion: quaternion(c.quaternion), fov: c.fov, zoom: c.zoom, near: c.near, far: c.far
    };
    if (new THREE.Vector3().fromArray(camera.up).lengthSq() < 1e-12 ||
        new THREE.Vector3().fromArray(camera.position).distanceToSquared(new THREE.Vector3().fromArray(camera.target)) < 1e-12) fail();
    // Older JSONL files encode dolly zoom implicitly in position/target.
    camera.distance = c.distance ?? new THREE.Vector3().fromArray(camera.position)
        .distanceTo(new THREE.Vector3().fromArray(camera.target));
    if (!Number.isFinite(camera.distance) || camera.distance <= 0) fail();
    if (Number.isFinite(c.aspect) && c.aspect > 0) camera.aspect = c.aspect;
    let model = null;
    if (value.model != null) {
        model = {
            position: vector(value.model.position, 3), quaternion: quaternion(value.model.quaternion),
            scale: vector(value.model.scale, 3)
        };
        if (model.scale.some(n => n <= 0)) fail();
    }
    if (value.info !== undefined && typeof value.info !== 'string') fail();
    const point = {
        version: 1, name: value.name.trim(), info: value.info ?? `${value.name.trim()}-YourCommentsHere`,
        viewerId: typeof value.viewerId === 'string' ? value.viewerId : '', camera, model
    };
    if (value.viewport) {
        const { width, height, pixelRatio } = value.viewport;
        if (![width, height, pixelRatio].every(n => Number.isFinite(n) && n > 0)) fail();
        point.viewport = { width, height, pixelRatio };
    }
    return point;
}

export function parseFlightPoints(text) {
    const points = [];
    text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) return;
        try { points.push(validatePoint(JSON.parse(line))); }
        catch (error) { throw new Error(`Zeile ${index + 1}: ${error.message}`); }
    });
    return points;
}

export function createFlightRecorder(viewer, options = {}, modelFile = '') {
    let points = [], flight = null, presenting = false, disposed = false;
    let activeIndex = -1, activePoint = null;
    let initialView, returnRequest = 0;
    // Capture after the caller's synchronous camera setup, before animation starts.
    // Capture the model's final intro targets after ready callbacks (e.g. initial tilt).
    const initialViewReady = Promise.resolve().then(() => {
        if (disposed) return;
        initialView = { ...viewer.getViewport(), name: 'Startansicht', info: '', model: null };
        const camera = viewer.camera.clone(false);
        camera.lookAt(viewer.controls.target);
        initialView.camera.quaternion = camera.quaternion.toArray();
        return viewer.ready;
    }).then(() => {
        if (disposed || !viewer.model) return;
        initialView.model = {
            position: viewer.model.position.toArray(),
            quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(
                viewer.modRotTarget.x, viewer.modRotTarget.y, viewer.modRotTarget.z,
                viewer.model.rotation.order)).toArray(),
            scale: [viewer.targetscale, viewer.targetscale, viewer.targetscale]
        };
    });
    initialViewReady.catch(() => {}); // Model errors are already displayed by the viewer.
    let loadController;
    const transTime = Number.isFinite(options.transTime) && options.transTime > 0 ? options.transTime : TRANSTIME;
    const events = new AbortController();
    const on = (element, type, handler) => element.addEventListener(type, handler, { signal: events.signal });
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const button = (text, action, parent) => {
        const node = element('button', '', text);
        node.type = 'button';
        on(node, 'click', action);
        parent.append(node);
        return node;
    };
    const launcher = element('button', 'jo3dviewport-button', 'Record');
    launcher.title = 'Flight Recorder öffnen (Entwicklerwerkzeug)';
    launcher.id = `${viewer.container.id}-flight-recorder-button`;
    launcher.type = 'button';
    launcher.hidden = options.flightRecorder === false;
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-expanded', 'false');
    const launchers = element('div', 'jo3dlaunchers');
    const presentationButton = button('Presentation', () => startPresentation(), launchers);
    presentationButton.className = 'jo3dpresentation-button';
    presentationButton.hidden = true;
    launchers.append(launcher);
    viewer.container.append(launchers);

    // A non-modal dialog outside the canvas container also fits compact/embedded viewers.
    const panel = element('dialog', 'jo3dflight');
    panel.id = `${viewer.container.id}-flight-recorder`;
    launcher.setAttribute('aria-controls', panel.id);
    const heading = element('header', 'jo3dflight-heading');
    const title = element('strong', '', `Flight Recorder · ${viewer.container.id}`);
    title.id = `${panel.id}-title`;
    panel.setAttribute('aria-labelledby', title.id);
    heading.append(title);
    const close = () => { panel.close(); launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); };
    button('×', close, heading).setAttribute('aria-label', 'Flight Recorder schließen');
    const toolbar = element('div', 'jo3dtoolbar jo3dflight-toolbar');
    const list = element('div', 'jo3dflight-list');
    list.setAttribute('role', 'group');
    const listTitle = element('div', 'jo3dflight-list-title');
    listTitle.id = `${panel.id}-points-title`;
    list.setAttribute('aria-labelledby', listTitle.id);
    const pointList = element('div', 'jo3dflight-points');
    list.append(listTitle, pointList);
    const status = element('p', 'jo3dflight-status', 'Ansicht wählen und mit „View loggen“ aufnehmen.');
    status.setAttribute('role', 'status');
    panel.append(heading, toolbar, list, status);
    document.body.append(panel);
    let fileName;
    // Preserve relative directories and URL query/hash while replacing the model extension.
    const modelPresentationFile = modelFile.replace(/\.[^./?#]+(?=[?#]|$)/, '.jsonl');
    const presentationFile = () => options.presentationFile ?? viewer.container.dataset.presentationFile ?? modelPresentationFile;
    async function checkPresentationFile() {
        const name = presentationFile();
        if (!name) return;
        try {
            const response = await fetch(name, { method: 'HEAD', cache: 'no-store', signal: events.signal });
            if (!disposed) presentationButton.hidden = !response.ok;
        } catch {
            // A missing or unreachable companion file simply has no launcher.
            if (!disposed) presentationButton.hidden = true;
        }
    }
    checkPresentationFile();

    const infoBox = element('section', 'jo3dflight-info');
    infoBox.setAttribute('aria-label', 'Flugpunkt-Info');
    let collapseTimer;
    let collapseAnimation, toggleAnimation;
    const reducedInfoMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const compactInfo = window.matchMedia('(max-width: 1024px), (max-height: 600px)');
    const infoHeading = element('header', 'jo3dflight-info-heading');
    const infoTitle = element('strong', 'jo3dflight-info-title');
    const infoToggle = button('⌃', () => {
        clearTimeout(collapseTimer);
        setInfoCollapsed(!infoBox.classList.contains('is-collapsed'));
    }, infoHeading);
    infoToggle.className = 'jo3dflight-info-toggle';
    infoHeading.prepend(infoTitle);
    const infoText = element('p', 'jo3dflight-info-text');
    infoText.id = `${panel.id}-info-text`;
    infoToggle.setAttribute('aria-controls', infoText.id);
    infoText.setAttribute('aria-live', 'polite');
    const navigation = element('nav', 'jo3dtoolbar jo3dflight-navigation');
    navigation.setAttribute('aria-label', 'Präsentation steuern');
    const navigationButton = (symbol, label, action) => {
        const node = button(symbol, action, navigation);
        node.title = label;
        node.setAttribute('aria-label', label);
        return node;
    };

    const startButton = navigationButton('⏮\uFE0E', 'START – Startpunkt anfliegen', () => flyTo(0));
    const previousButton = navigationButton('◀\uFE0E', 'Vorherigen Punkt anfliegen', () => flyTo(activeIndex - 1));
    const nextButton = navigationButton('▶\uFE0E', 'Nächsten Punkt anfliegen', () => flyTo(activeIndex + 1));
    navigationButton('⏹\uFE0E', 'END – Präsentation beenden', startAutoRotation);


    infoBox.append(infoHeading, infoText, navigation);
    viewer.container.append(infoBox);
    hideInfo();

    function setInfoCollapsed(collapsed) {
        const changed = infoBox.classList.contains('is-collapsed') !== collapsed;
        const animate = changed && infoBox.classList.contains('is-visible') && !reducedInfoMotion.matches;
        const before = animate ? infoBox.getBoundingClientRect() : null;
        collapseAnimation?.cancel();
        toggleAnimation?.cancel();
        infoBox.classList.toggle('is-collapsed', collapsed);
        infoText.hidden = collapsed;
        infoToggle.textContent = collapsed ? '\u25BC\uFE0E' : '\u25B2\uFE0E';
        infoToggle.setAttribute('aria-expanded', String(!collapsed));
        infoToggle.title = collapsed ? 'Info aufklappen' : 'Info zuklappen';
        infoToggle.setAttribute('aria-label', infoToggle.title);
        if (animate) {
            const after = infoBox.getBoundingClientRect();
            collapseAnimation = infoBox.animate([
                { width: `${before.width}px`, height: `${before.height}px`, overflow: 'hidden' },
                { width: `${after.width}px`, height: `${after.height}px`, overflow: 'hidden' }
            ], { duration: 320, easing: 'ease-in-out' });
            toggleAnimation = infoToggle.animate([
                { opacity: .35, transform: 'scale(.85)' },
                { opacity: 1, transform: 'scale(1)' }
            ], { duration: 320, easing: 'ease-out' });
        }
    }
    function scheduleInfoCollapse() {
        clearTimeout(collapseTimer);
        if (compactInfo.matches && infoBox.classList.contains('is-visible')) {
            collapseTimer = setTimeout(() => setInfoCollapsed(true), 2000);
        }
    }
    on(compactInfo, 'change', () => {
        setInfoCollapsed(false);
        scheduleInfoCollapse();
    });
    function hideInfo() {
        clearTimeout(collapseTimer);
        collapseAnimation?.cancel();
        toggleAnimation?.cancel();
        if (infoBox.contains(document.activeElement)) viewer.renderer.domElement.focus({ preventScroll: true });
        infoBox.classList.remove('is-visible');
        infoBox.inert = true;
        infoBox.setAttribute('aria-hidden', 'true');
    }
    function refreshInfo() {
        if (!activePoint) return;
        infoTitle.textContent = activePoint.name;
        // Display literal escape sequences and real line breaks, never interpret HTML.
        infoText.textContent = activePoint.info.replace(/\\n/g, '\n');
        startButton.disabled = points.length === 0;
        previousButton.disabled = activeIndex <= 0;
        nextButton.disabled = activeIndex < 0 || activeIndex >= points.length - 1;
    }
    function showInfo(point, index) {
        activeIndex = index;
        activePoint = index >= 0 ? points[index] : point;
        refreshInfo();
        infoBox.inert = false;
        infoBox.setAttribute('aria-hidden', 'false');
        infoBox.classList.add('is-visible');
        setInfoCollapsed(false);
        scheduleInfoCollapse();
    }
    const editableInfo = info => info.replace(/\r?\n/g, '\\n');

    function freezeModel() {
        if (!viewer.model) return;
        viewer.modRotTarget.set(viewer.model.rotation.x, viewer.model.rotation.y, viewer.model.rotation.z);
        viewer.modelscale = viewer.targetscale = viewer.model.scale.x;
    }
    function stop() {
        ++returnRequest;
        hideInfo(); activeIndex = -1; activePoint = null;
        if (!presenting) return;
        if (flight) status.textContent = 'Flug angehalten.';
        flight = null;
        presenting = false;
        freezeModel();
        viewer.invalidate();
    }
    function cancelLoad() {
        loadController?.abort(); loadController = undefined;
        presentationButton.textContent = 'Presentation';
        presentationButton.removeAttribute('aria-busy');
    }
    function renderList() {
        listTitle.textContent = `Flugpunkte (${points.length})`;
        pointList.replaceChildren();
        if (!points.length) pointList.append(element('p', 'jo3dflight-empty', 'Noch keine Flugpunkte.'));
        points.forEach((point, index) => {
            const row = element('div', 'jo3dflight-point');
            const pointActions = element('div', 'jo3dflight-point-actions');
            const go = element('button', 'jo3dflight-go', point.name);
            go.type = 'button';
            go.dataset.pointIndex = index;
            const edit = element('button', 'jo3dflight-edit', 'Edit');
            edit.type = 'button'; edit.dataset.pointIndex = index; edit.dataset.action = 'edit';
            edit.title = `Info für „${point.name}“ bearbeiten`;
            pointActions.append(go, edit);
            const zoom = element('small', 'jo3dflight-zoom',
                `Zoom ${point.camera.zoom.toFixed(2)}× · Distanz ${point.camera.distance.toFixed(3)}`);
            const label = element('label', '', 'Info');
            const info = element('input', '');
            info.type = 'text'; info.value = editableInfo(point.info); info.dataset.pointIndex = index;
            label.append(info);
            row.append(pointActions, zoom, label);
            pointList.append(row);
        });
        refreshInfo();
    }
    function record() {
        if (disposed) return;
        if (!viewer.model) { status.textContent = 'Bitte warten, bis das Modell geladen ist.'; return; }
        // Capture before prompt opens, so the name describes the view at the click.
        const snapshot = viewer.getViewport();
        const name = window.prompt('Kurzer Name für diesen Flugpunkt:', `Punkt ${points.length + 1}`);
        if (name === null || !name.trim()) return;
        const point = validatePoint({ ...snapshot, name, info: `${name.trim()}-YourCommentsHere` });
        points.push(point);
        console.log(JSON.stringify(point, null, 2));
        renderList();
        status.textContent = `„${point.name}“ aufgenommen.`;
    }
    function reset() {
        cancelLoad(); stop(); points = []; renderList();
        status.textContent = 'Flugpunkte gelöscht.';
    }
    function startAutoRotation() {
        if (disposed) return;
        cancelLoad();
        if (initialView?.model) return beginFlight(initialView, -1, true);
        viewer.setAutoRotate(false);
        const request = ++returnRequest;
        status.textContent = 'Startansicht wird vorbereitet …';
        return initialViewReady.then(() => {
            if (!disposed && request === returnRequest) return beginFlight(initialView, -1, true);
        }).catch(error => {
            if (!disposed && request === returnRequest) status.textContent = `Rückflug fehlgeschlagen: ${error.message}`;
        });
    }
    async function load() {
        const name = window.prompt('Dateiname der JSONL-Datei im Projekt:', fileName ?? presentationFile());
        if (name === null || !name.trim()) return;
        return loadFile(name.trim());
    }
    function startPresentation(name = presentationFile()) {
        return loadFile(name, true);
    }
    async function loadFile(name, present = false) {
        if (disposed) return false;
        cancelLoad();
        const controller = new AbortController();
        loadController = controller;
        status.textContent = 'Flugpunkte werden geladen …';
        if (present) {
            presentationButton.textContent = 'Lädt …';
            presentationButton.setAttribute('aria-busy', 'true');
        }
        try {
            const response = await fetch(name, { signal: controller.signal, cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const next = parseFlightPoints(await response.text());
            if (present) {
                if (!next.length) throw new Error('Die Datei enthält keine Flugpunkte.');
                await viewer.ready;
            }
            if (disposed || controller.signal.aborted) return false;
            stop(); points = next; fileName = name; renderList();
            status.textContent = `${points.length} Flugpunkte geladen.`;
            if (present) {
                panel.close(); launcher.setAttribute('aria-expanded', 'false');
                flyTo(0);
            }
            return true;
        } catch (error) {
            if (!disposed && !controller.signal.aborted) {
                status.textContent = `Laden fehlgeschlagen (${name}): ${error.message}`;
                if (present) { panel.show(); launcher.setAttribute('aria-expanded', 'true'); }
            }
            return false;
        } finally {
            if (loadController === controller) {
                loadController = undefined;
                presentationButton.textContent = 'Presentation';
                presentationButton.removeAttribute('aria-busy');
            }
        }
    }
    const downloads = new Map();
    function exportPoints() {
        const jsonl = points.map(point => JSON.stringify(point)).join('\n') + (points.length ? '\n' : '');
        const url = URL.createObjectURL(new Blob([jsonl], { type: 'application/x-ndjson;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = (fileName ?? presentationFile()).split(/[\\/]/).pop().split(/[?#]/)[0] || 'flight-points.jsonl';
        if (!link.download.toLowerCase().endsWith('.jsonl')) link.download += '.jsonl';
        link.hidden = true; document.body.append(link); link.click(); link.remove();
        downloads.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000));
        status.textContent = 'JSONL exportiert. Die Datei unter dem Modellnamen mit Endung .jsonl neben dem Modell speichern.';
    }
    button('Reset', reset, toolbar);
    button('View loggen', record, toolbar);
    button('Laden', load, toolbar);
    button('Export', exportPoints, toolbar);
    button('Auto', startAutoRotation, toolbar);
    on(launcher, 'click', () => {
        viewer.setAutoRotate(false);
        panel.show(); launcher.setAttribute('aria-expanded', 'true');
    });
    on(panel, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    on(list, 'input', event => {
        if (event.target.matches('input[data-point-index]')) {
            points[Number(event.target.dataset.pointIndex)].info = event.target.value;
            refreshInfo();
        }
    });
    on(list, 'click', event => {
        const go = event.target.closest('button[data-point-index]');
        if (!go) return;
        const index = Number(go.dataset.pointIndex);
        if (go.dataset.action === 'edit') {
            const point = points[index];
            const text = window.prompt(`Info für „${point.name}“ (\\n für Zeilenumbruch):`, editableInfo(point.info));
            if (text !== null) {
                point.info = text;
                go.closest('.jo3dflight-point').querySelector('input').value = editableInfo(text);
                refreshInfo();
            }
            return;
        }
        try { flyTo(index); }
        catch (error) { status.textContent = error.message; }
    });
    renderList();

    function pose(snapshot) {
        const c = snapshot.camera;
        const q = new THREE.Quaternion().fromArray(c.quaternion).normalize();
        const target = new THREE.Vector3().fromArray(c.target);
        const position = new THREE.Vector3().fromArray(c.position);
        const offset = position.clone().sub(target);
        if (c.distance !== undefined) offset.setLength(c.distance);
        position.copy(target).add(offset);
        return {
            position, target, up: new THREE.Vector3().fromArray(c.up), quaternion: q,
            // Interpolate in camera space to orbit around the object instead of cutting through it.
            offset: offset.applyQuaternion(q.clone().invert()),
            fov: c.fov, zoom: c.zoom, near: c.near, far: c.far,
            model: snapshot.model ? {
                position: new THREE.Vector3().fromArray(snapshot.model.position),
                quaternion: new THREE.Quaternion().fromArray(snapshot.model.quaternion).normalize(),
                scale: new THREE.Vector3().fromArray(snapshot.model.scale)
            } : null
        };
    }
    function flyTo(value) {
        if (disposed) return;
        if (!viewer.model) throw new Error('Bitte warten, bis das Modell geladen ist.');
        const index = typeof value === 'number' ? value : points.findIndex(point =>
            point === value || JSON.stringify(point) === JSON.stringify(value));
        if (typeof value === 'number' && (!Number.isInteger(index) || index < 0 || index >= points.length)) return;
        const point = validatePoint(typeof value === 'number' ? points[index] : value);
        return beginFlight(point, index);
    }
    function beginFlight(point, index, returningHome = false) {
        viewer.setAutoRotate(false);
        const snapshot = viewer.getViewport();
        // Drain pending OrbitControls damping without changing the captured starting pose.
        const damping = viewer.controls.enableDamping;
        viewer.controls.enableDamping = false;
        viewer.controls.update(0);
        viewer.controls.enableDamping = damping;
        viewer.camera.position.fromArray(snapshot.camera.position);
        viewer.camera.quaternion.fromArray(snapshot.camera.quaternion);
        viewer.controls.target.fromArray(snapshot.camera.target);
        const from = pose(snapshot), to = pose(point);
        const distance = Math.max(from.position.distanceTo(to.position), from.target.distanceTo(to.target), 0.25);
        const duration = transTime * (distance <= 1 ? distance : Math.sqrt(distance));
        flight = { from, to, elapsed: 0, duration, point, index, returningHome };
        presenting = true;
        status.textContent = returningHome ? `Rückflug zur Startansicht · ${duration.toFixed(1)} s`
            : `Flug zu „${point.name}“ · ${duration.toFixed(1)} s`;
        viewer.invalidate();
        return duration;
    }
    const offset = new THREE.Vector3();
    function update(dt) {
        if (!flight) return presenting;
        const { from, to } = flight;
        flight.elapsed += dt;
        const progress = Math.min(1, flight.elapsed / flight.duration);
        const t = progress * progress * progress * (progress * (progress * 6 - 15) + 10);
        const { camera, controls, model } = viewer;
        controls.target.lerpVectors(from.target, to.target, t);
        camera.quaternion.slerpQuaternions(from.quaternion, to.quaternion, t);
        camera.position.copy(controls.target).add(offset.lerpVectors(from.offset, to.offset, t).applyQuaternion(camera.quaternion));
        camera.up.lerpVectors(from.up, to.up, t);
        if (camera.up.lengthSq() < 1e-12) camera.up.copy(to.up);
        camera.up.normalize();
        for (const key of ['fov', 'zoom', 'near', 'far']) camera[key] = THREE.MathUtils.lerp(from[key], to[key], t);
        // Aspect and buffer dimensions always belong to the live browser, not the recording.
        camera.updateProjectionMatrix();
        if (model && from.model && to.model) {
            model.position.lerpVectors(from.model.position, to.model.position, t);
            model.quaternion.slerpQuaternions(from.model.quaternion, to.model.quaternion, t);
            model.scale.lerpVectors(from.model.scale, to.model.scale, t);
        }
        if (progress === 1) {
            camera.position.copy(to.position);
            freezeModel();
            const completed = flight;
            flight = null;
            if (completed.returningHome) {
                viewer.setAutoRotate(true);
                status.textContent = 'Startansicht erreicht. Auto-Rotation gestartet.';
            } else {
                status.textContent = `„${completed.point.name}“ erreicht.`;
                showInfo(completed.point, completed.index);
            }
        }
        viewer.invalidate();
        return true;
    }
    return {
        button: launcher, presentationButton, panel, infoBox, record, reset, flyTo, stop, update, startAutoRotation, startPresentation,
        get currentIndex() { return activeIndex; },
        get isPresenting() { return presenting; },
        get isFlying() { return flight !== null; },
        get points() { return structuredClone(points); },
        dispose() {
            disposed = true; stop(); cancelLoad(); events.abort();
            downloads.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url); });
            downloads.clear(); panel.remove(); launchers.remove(); infoBox.remove();
        }
    };
}
