# JoEmbedded 3D Viewer

A browser-based GLTF/GLB viewer for circuit boards, sensors and product models.
The demos use **Three.js**, mouse/touch orbit controls and optional
image or Video-MP4 skyboxes. No build step is required. "Just works":

![Preview](teaser.png)

## Demos

Every HTML entry point is listed below. **Open demo** links target GitHub Pages;
**Source** links open the HTML in this repository. Updated Pages URLs become
available after the reorganized files are published to GitHub Pages.

| Page | Purpose | Open demo | Source |
| --- | --- | --- | --- |
| `index.html` | Entry page with links to all demos, a RAK3172 module and a compact material sample | [Open demo](https://joembedded.github.io/viewer3d/index.html) | [Source](index.html) |
| `skybox-explorer.html` | Scientific logger with all six image panoramas and the MP4 skybox | [Open demo](https://joembedded.github.io/viewer3d/skybox-explorer.html) | [Source](skybox-explorer.html) |
| `jpiot-pcb.html` | JPIoT circuit board with studio lighting and soft contact shadows | [Open demo](https://joembedded.github.io/viewer3d/jpiot-pcb.html) | [Source](jpiot-pcb.html) |
| `scientific-logger.html` | Scientific logger in its laboratory panorama | [Open demo](https://joembedded.github.io/viewer3d/scientific-logger.html) | [Source](scientific-logger.html) |
| `material-preview.html` | Polished aluminium, polymer and satin-metal sample | [Open demo](https://joembedded.github.io/viewer3d/material-preview.html) | [Source](material-preview.html) |
| `ble-sensor.html` | OSX sensor orientation controlled by a Bluetooth device | [Open demo](https://joembedded.github.io/viewer3d/ble-sensor.html) | [Source](ble-sensor.html) |

The former `index2.html`, `jpiot.html`, `boilerplate_gp.html`,
`boilerplate_sg.html` and `boilerplate_gp_video.html` have been renamed to the
corresponding descriptive pages above. Update existing bookmarks and embeds.
Every page uses a centered 90% content width, leaving 5% on the left and right
of the available viewport (excluding the scrollbar). The shared rules live in
`driver_js/page-layout.css`. Each page includes a "Zurück" link to `index.html`.
The introductory and Bluetooth pages also retain 5vh top and bottom padding;
compact viewers shrink to fit narrow screens.

## Repository layout

```text
*.html                    Demo entry points
models/                   GLB models, including the original material sample
  source/                 Editable Three.js project and its source artwork
skyboxes/                 Panorama images and MP4 videos
driver_js/               Viewer, Bluetooth drivers and shared styles
  three/                  Minimal local Three.js runtime and required add-ons
tools/                   Asset generation and verification utilities
favicon.ico               Site icon
LICENSE                   Project license
readme.md                 Documentation and demo links
```

Temporary browser reports, screenshots, caches and local backups are excluded
from version control. Unused Three.js add-ons and historical output files have
been removed from the active project. Required runtime libraries retain their
copyright/license headers.

## Run locally

Serve the repository root over HTTP. For XAMPP, open
`http://localhost/viewer3d/index.html`. Alternatively:

```sh
python -m http.server 8765
```

Then open `http://localhost:8765/index.html`. Loading ES modules and models via
`file://` is not supported. Asset paths are relative to the HTML document, so
the same layout works under a GitHub Pages project subdirectory.

## Embed a viewer

Add a container with an explicit height, the stylesheet and this import map:

```html
<link rel="stylesheet" href="./driver_js/jo3dview.css">
<script type="importmap">
{
  "imports": {
    "three": "./driver_js/three/build/three.module.min.js",
    "three/addons/": "./driver_js/three/examples/jsm/"
  }
}
</script>
<div id="viewer-controls"></div>
<div id="mviewer" class="jo3dviewer" style="height: 60vh">
  <div id="mloader" class="jo3dloader" role="status">Loading...</div>
</div>
```

Initialize it from a module script:

```js
import { view3dDocumentation } from './driver_js/jo3dview.js';

const viewer = view3dDocumentation('mviewer', {
    model: './models/testball-optimized.glb',
    background: './skyboxes/southern-germany.webp',
    loaderId: 'mloader',
    toolbarId: 'viewer-controls', // optional
    autoRotatePause: 10
});
await viewer.ready; // model loaded; rejects on model-loading errors
await viewer.backgroundReady; // true on background load, false on failure

// viewer.setAutoRotate(false);
// viewer.setNeutralBackground(true); // preserves environment lighting
// viewer.resetView();
// viewer.invalidate(); // after manual scene/material changes
// viewer.dispose(); // releases resources when removing the viewer
```

For a minimal integration, `view3d(containerId, model, size, loaderId,
background, centerModel, options)` remains available. Its seventh argument
accepts the rendering options used by the documentation preset.

The preset uses ACES tone mapping, exposure 1.05, environment intensity 1.25,
background intensity 0.85 and normalized model size 1.1. Override `exposure`,
`environmentIntensity`, `backgroundIntensity`, `fov`, `size` and
`cameraPosition: [x, y, z]` as needed. The camera adapts to portrait screens.
Rotation defaults to off when reduced motion is requested. Interaction pauses
auto-rotation for 10 seconds after release. Hidden/offscreen views skip rendering;
stationary documentation viewers render only when necessary. Pixel ratio is
capped at 1.75 and the drawing buffer at 3 million pixels by default.

Optional `modelAutoRotateSpeed: [x, y, z]` adds model rotation around each Euler
axis while camera auto-rotation is active. It defaults to `[0, 0, 0]` (disabled) and uses the same
units as `autoRotateSpeed`: `1` is one full turn per 60 seconds; negative values
reverse direction. The extra rotation follows the same interaction pauses,
rotation toggle and visibility handling. The Scientific logger uses
`autoRotateSpeed: -0.35` and `modelAutoRotateSpeed: [-0.175, 0, 0]` (half speed
around X). The Skybox Explorer uses `[2, 0.5, 0.35]` for rotation on all three
axes. Each zero component disables its axis. Older scalar values remain
supported as an X-only speed.

## Skyboxes and background selection

Put equirectangular panorama images and videos in `skyboxes/`. Full 360-degree
panoramas normally have a 2:1 aspect ratio. `skybox-explorer.html` lists the
available assets in its `backgrounds` array with per-environment light levels.
Add an entry there when adding a new skybox. Neutral camera-relative lights
keep labels readable while the selected panorama supplies metal reflections.

Switch backgrounds without reloading the model or resetting the camera:

```js
const loaded = await viewer.setBackground('./skyboxes/industrial_skybox.mp4', {
    environmentFallbackImage: './skyboxes/industrial_skybox.png'
});
```

The returned promise resolves to `true` on load or `false` on failure or
supersession. Old textures/video decoders are released, and late image responses
cannot overwrite a newer selection. `viewer.backgroundReady` always refers to
the latest load.

### MP4 playback and reflections

MP4 skyboxes loop muted and inline. Playback pauses when the tab/viewer is
hidden or the neutral background is selected. If autoplay is blocked, a click,
touch or key press inside the viewer retries playback. `viewer.backgroundVideo`
exposes the video element for custom controls. Browser-supported video codecs
are required; cross-origin media must permit CORS.

Reflections use the first available video frame, captured once at up to 1024
pixels wide. If capture is unavailable, the driver tries the same filename with
a `.PNG` extension. `environmentFallbackImage` overrides this path; use the
actual filename case on case-sensitive servers. An explicit `environmentImage`
can instead select a static reflection image from the start. No environment map
is regenerated per frame. A failed video uses a neutral background and invokes
`onBackgroundError`, while preserving available environment lighting.

Video backgrounds use an independent perspective camera: `backgroundFov`
defaults to 60 degrees before aspect adjustment, with `maxBackgroundFov: 85`
limiting both axes. This shows more room without a fisheye projection or changing
model framing. These controls apply to video; still panoramas use the model
camera. `backgroundBlurriness` applies to static image panoramas.

## Bluetooth sensor

Open `ble-sensor.html` using a browser with Web Bluetooth support on HTTPS or
localhost. A compatible OSX orientation sensor is required for live data.

1. Click **Connect** and choose the device.
2. If a PIN is required, enter `.i PIN` in the terminal once; it is stored locally.
3. Click **Start** to follow the physical sensor orientation (allow about 5 seconds).
4. Click **Stop** to stop the sensor stream.

The terminal uses `driver_js/blx.js`, `driver_js/blStore.js` and
`driver_js/FileSaver.js`. Real hardware communication must be checked with a
connected sensor; browser-only smoke checks do not verify a Bluetooth link.

## Model sources and asset generation

`models/source/three_editor_project.json` and `models/source/logo.png` preserve
the editable model source. `models/testball.glb` is the original material sample;
`models/testball-optimized.glb` removes the masonry bump and blue emission and
uses polished aluminium, red polymer and satin metal. Both are used by demos.

Rebuild the optimized sample using the Python standard library:

```sh
python tools/optimize-demo.py
```

Optionally regenerate the Southern Germany WebP from a supplied original image
(requires Pillow):

```sh
python tools/optimize-demo.py --panorama path/to/original-panorama.jpg
```

The panorama is limited to 2560 x 1280 pixels and encoded at WebP quality 85.
The original high-resolution photograph is not required for normal operation.
These LDR panoramas provide reflections but do not reproduce the full lighting
range of an HDR environment.

## Browser checks

With XAMPP serving `http://localhost/viewer3d/` and Playwright CLI installed,
run these commands from the repository root (PowerShell):

```powershell
New-Item -ItemType Directory -Path output/playwright -Force
playwright-cli -s=viewer open http://localhost/viewer3d/index.html --headed
playwright-cli -s=viewer run-code --filename=tools/check-pages.js
playwright-cli -s=viewer run-code --filename=tools/check-backgrounds.js
playwright-cli -s=viewer run-code --filename=tools/check-model-rotation.js
```

The checks load every page at desktop and mobile widths, verify the 5% demo
padding, test all skyboxes and cover video loops, fallback reflections, rapid
background changes and cleanup. The model-rotation check verifies half speed,
pause/resume, visibility, reduced motion and the disabled default.
Screenshots go to the ignored `output/` folder.

## Dependencies and license

The retained [Three.js](https://threejs.org/) subset contains its two runtime
modules, OrbitControls, GLTFLoader and BufferGeometryUtils. Bluetooth support
and FileSaver are also bundled locally. See the source license headers and the
project [MIT license](LICENSE).
