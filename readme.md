# 3D-Viewer für GLTF/GLB-Modelle

Dies ist ein einfacher Viewer für 3D-Modelle im GLTF- oder GLB-Format.
Er eignet sich z.B. für die Darstellung von Leiterplatten-Modellen, wie sie etwa KiCad erzeugen kann.

## Features
- Anzeige von GLTF/GLB-Modellen im Browser
- Zentrierung und automatische Skalierung des Modells
- Steuerung per Maus/Touch (OrbitControls)
- Ladeanzeige während des Modell-Ladevorgangs

## Benutzung
1. Lege dein 3D-Modell (z.B. `rak3172sip.glb`) ins Verzeichnis (siehe `loader.load('rak3172sip.glb', ...)`)
2. Öffne die `index.html` im Browser (am besten über einen lokalen Webserver, z.B. mit [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) für VS Code).
3. Das Modell wird automatisch geladen und angezeigt.

## Abhängigkeiten
- [three.js](https://threejs.org/) (wird per CDN eingebunden)

---
(c) JoEmbedded, 2025
