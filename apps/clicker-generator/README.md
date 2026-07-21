# Clicker Generator

Browser-based generator that turns an image into a print-ready **3MF** of a multicolor "clicker" — a 3D-printed pressable button built around a real **Cherry MX** mechanical switch. 100% client-side, deployed on GitHub Pages (no backend, no hosting cost).

**Live site:** https://vostoklabs.github.io/Clicker-Generator/

## How it works

1. Upload an image — it's quantized into a small color palette and traced into 2D regions.
2. A geometry worker (the [manifold-3d](https://github.com/elalish/manifold) WASM kernel, off the main thread) builds a watertight, multicolor cap + body around a real MX switch socket/stem.
3. three.js renders a live preview; export produces a print-ready multicolor **3MF**.

All geometry is in millimeters, and every exported solid is watertight / manifold.

## Run it locally

### Prerequisites

- **[Node.js](https://nodejs.org/) 20 or newer** (includes `npm`). Check what you have with:
  ```bash
  node -v
  npm -v
  ```
- **[Git](https://git-scm.com/)** to clone the repo (or just download the ZIP from GitHub instead).

### 1. Get the code

**Option A — download the ZIP (easiest, no Git needed):**

1. Open the [GitHub page](https://github.com/vostoklabs/Clicker-Generator).
2. Click the green **Code** button → **Download ZIP**.
3. Find the downloaded `.zip` (usually in your **Downloads** folder) and **extract / unzip** it. You'll get a folder like `Clicker-Generator-main`.

**Option B — clone with Git** (if you have [Git](https://git-scm.com/) installed):

```bash
git clone https://github.com/vostoklabs/Clicker-Generator.git
```

### 2. Open a terminal in the project folder

All the commands below have to be run **from inside the project folder** (the one that contains `package.json`). Pick whichever way is easiest for you:

**Windows:**

- Open the unzipped folder in **File Explorer**, then either:
  - Click the address bar at the top, type `cmd`, and press **Enter** — a Command Prompt opens already pointed at that folder. *(My favorite — quickest way.)*
  - Or **right-click** an empty area inside the folder and choose **Open in Terminal** (Windows 11) or **Open PowerShell window here**.
- Or open **Command Prompt** / **PowerShell** from the Start menu and `cd` into the folder manually:
  ```bash
  cd "C:\Users\YourName\Downloads\Clicker-Generator-main"
  ```
  (Tip: type `cd ` with a space, then drag the folder onto the window to paste its full path.)

**macOS / Linux:**

- Open the **Terminal** app and `cd` into the folder:
  ```bash
  cd ~/Downloads/Clicker-Generator-main
  ```
  (On macOS you can drag the folder onto the Terminal window to paste its path.)

To double-check you're in the right place, run `dir` (Windows) or `ls` (Mac/Linux) — you should see `package.json` and `index.html` in the listing.

### 3. Install the dependencies

In that terminal, install all the packages the project needs (they're listed in `package.json`):

```bash
npm install
```

This downloads everything into a new `node_modules/` folder. It can take a minute or two the first time, and you'll see a progress log. You only need to do this **once** — or again later if you pull changes that update the dependencies.

> If you get `'npm' is not recognized` (Windows) or `command not found: npm`, Node.js isn't installed (or the terminal was open before you installed it). Install [Node.js 20+](https://nodejs.org/), close the terminal, and reopen it.

### 4. Start the dev server

```bash
npm run dev
```

Vite starts a local web server and prints a URL:

```
  ➜  Local:   http://localhost:5173/
```

Open that address in your browser (Ctrl+click the link, or copy-paste it) and the app loads. It **hot-reloads** automatically as you edit files, so you can leave it running.

When you're done, go back to the terminal and press **Ctrl+C** to stop the server.

### Other commands

```bash
npm run build     # typecheck + production build -> dist/
npm run preview   # serve the production build locally
npm run typecheck # type-check only, no build
```

**Stack:** Vite + TypeScript + three.js, with **manifold-3d** (WASM) as the geometry kernel running in a Web Worker. three.js is display-only.

## Deploy

Pushing to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which builds the static site and publishes `dist/` to GitHub Pages.

One-time setup: in the repo, go to **Settings → Pages → Source** and select **GitHub Actions**. `vite.config.ts` uses `base: './'` (relative paths) so the build works at any Pages URL without reconfiguration.
