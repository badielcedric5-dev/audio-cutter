# 🎵 AudioStudio AI

**AudioStudio AI** est une Station de Travail Audio Numérique (DAW) moderne et performante fonctionnant entièrement dans le navigateur. Elle combine des outils d'édition audio de précision (couper, copier, coller, mixer) avec la puissance de l'intelligence artificielle **Google Gemini 2.5** pour l'analyse sémantique du son.

---

## ✨ Fonctionnalités Principales

### 🎛️ Édition Audio Multi-Pistes Avancée
- **Pistes Illimitées :** Ajoutez autant de pistes que nécessaire.
- **Canvas "Infini" :** Ajout automatique de marges de sécurité (padding) pour permettre de travailler confortablement au-delà de la fin de l'audio.
- **Moteur "Buffer-First" :** Architecture optimisée manipulant les `AudioBuffer` en mémoire pour un rendu visuel instantané et zéro latence lors des modifications.
- **Outils d'Édition :**
  - **Couper / Supprimer (Ripple Delete) :** La suppression de temps recolle automatiquement les morceaux.
  - **Copier / Coller / Insérer :** Support complet du presse-papier (Ctrl+C, Ctrl+V, Ctrl+X) entre les pistes.
  - **Gestion de la Sélection :** Déplacement, redimensionnement et persistance des zones de sélection.

### 🎧 Gestion des Canaux & Spatialisation
- **Vue Stéréo (Split Channels) :** Visualisation distincte des canaux Gauche (Haut) et Droit (Bas).
- **Édition Sélective :** Appliquez des effets ou coupez uniquement le canal Gauche, le Droit, ou la Stéréo complète.
- **Conversion Automatique :** Transformation intelligente des fichiers Mono en Stéréo lors des manipulations spatiales.
- **Mixage :**
  - **Volume :** Gain ajustable par région (0% à 200%).
  - **Panoramique (Panning) :** Algorithme "Constant Power" pour une spatialisation naturelle et professionnelle.

### 🎙️ Enregistrement Intégré
- **Enregistrement Direct :** Capture microphone via le navigateur.
- **Modes d'Insertion :**
  - **Au curseur :** Insère l'enregistrement à l'endroit exact du clic.
  - **Écrasement (Overwrite) :** Remplace une région sélectionnée par le nouvel enregistrement.
  - **Remplacement de Canal :** Possibilité de faire du doublage uniquement sur l'oreille gauche ou droite.

### 🧠 Intelligence Artificielle (Google Gemini)
Intégration native de l'API Gemini 2.5 Flash pour analyser des segments audio sélectionnés :
- **Transcription :** Conversion précise de la parole en texte.
- **Résumé :** Synthèse automatique du contenu audio.
- **Analyse de Sentiment :** Détection du ton émotionnel.
- **Extraction de Mots-clés :** Identification des sujets principaux.

### 💾 Exportation & Formats
- **Mixage Final :** Fusion de toutes les pistes actives avec gestion automatique des volumes (limiteur).
- **Formats Supportés :**
  - **WAV (PCM) :** Qualité studio sans perte (encodage JS optimisé via TypedArrays).
  - **MP3 :** Compression via `lamejs`.
  - **MP4 / WebM :** Encodage via `FFmpeg.wasm` (WebAssembly) ou fallback natif `MediaRecorder`.
- **Nettoyage Automatique :** Suppression automatique du silence excédentaire en fin de projet lors de l'export.

---

## 🛠️ Stack Technique

Ce projet est construit avec des technologies web modernes :

- **Frontend :** React 19, TypeScript, Tailwind CSS.
- **Moteur Audio :** Web Audio API natif + WaveSurfer.js (v7) pour la visualisation.
- **Traitement Audio :** Algorithmes personnalisés (DSP) pour le mixage, le découpage et l'encodage WAV bas niveau.
- **IA :** Google GenAI SDK (`@google/genai`).
- **Encodage Externe :**
  - `ffmpeg.wasm` (Conversion MP4/WebM haute performance).
  - `lamejs` (Encodage MP3).

---

## ⌨️ Raccourcis Clavier

Pour une productivité maximale :

| Touche | Action |
|--------|--------|
| **Espace** | Lecture / Pause (de la piste ou de la sélection) |
| **Ctrl + C** | Copier la région sélectionnée |
| **Ctrl + V** | Coller (insère au curseur ou écrase si sélection) |
| **Ctrl + X** | Couper la sélection |
| **Suppr / Del** | Supprimer la région sélectionnée |

---

## 🚀 Installation et Démarrage

1. **Cloner le projet**
   ```bash
   git clone https://github.com/votre-user/audiostudio-ai.git
   cd audiostudio-ai
   ```

2. **Installer les dépendances**
   *Note : Ce projet utilise une structure sans build complexe (via CDN/ESM), mais si vous utilisez un environnement Node standard :*
   ```bash
   npm install
   ```

3. **Configuration de l'API Key**
   Créez un fichier `.env` à la racine :
   ```env
   API_KEY=votre_clé_google_gemini_ici
   ```

4. **Lancer le serveur de développement**
   ```bash
   npm start
   # ou
   npm run dev
   ```

---

## 🧩 Architecture Audio (Détails Techniques)

L'application contourne les limitations habituelles des éditeurs web :
1. **Pas de re-téléchargement :** Contrairement aux implémentations WaveSurfer classiques, nous ne rechargeons pas le fichier via URL à chaque coupe. Nous injectons directement les données brutes (`AudioBuffer.getChannelData`) dans le visualiseur.
2. **Synchronisation :** Les calculs audio (mixage, coupe) et le rendu visuel sont découplés mais synchronisés via des Refs React pour éviter les effets de clignotement.
3. **Sécurité Mémoire :** Gestion stricte des `Blobs` et des URL objets pour éviter les fuites de mémoire lors de longues sessions d'édition.

---

## 📄 Licence

Distribué sous la licence MIT. Voir `LICENSE` pour plus d'informations.