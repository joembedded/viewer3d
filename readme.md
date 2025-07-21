# 3D-Viewer für GLTF/GLB-Modelle

Dies ist ein einfacher Viewer für 3D-Modelle im GLTF- oder GLB-Format.  
Er eignet sich z.B. für die Darstellung von Leiterplatten-Modellen, wie sie etwa KiCad erzeugen kann.

[Live-Demo](https://joembedded.github.io/viewer3d/index.html)

## Features
- Anzeige von GLTF/GLB-Modellen im Browser
- Steuerung per Maus/Touch (OrbitControls)
- Ladeanzeige während des Modell-Ladevorgangs

## Benutzung
1. Lege das 3D-Modell (z.B. `rak3172sip.glb`) ins Verzeichnis
2. Kopiere die "MAGIC"-Blöcke mit Script und CSS in deine HTML-Seite
3. Baue die Divs für den 3D-Inhalt in den Body, der Loader-Div ist optional
4. Für jedes Modell einen Eintrag `view3d()` im "MAGIC"-Block setzen

## Abhängigkeiten
- [three.js](https://threejs.org/) (wird per CDN eingebunden)

---
