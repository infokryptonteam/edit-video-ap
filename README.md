# Clinical Case Video

Angular app for creating a vertical clinical case presentation from three photos. The doctor and clinic details stay fixed; the case name and healing period can be edited.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:4200/`. Upload the pre-operative, post-operative, and healing photos, edit the case details, preview the presentation, then choose **Download MP4**.

## Build

```bash
npm run build
```

MP4 creation runs in the browser using the bundled FFmpeg WebAssembly core. Photos are not uploaded to a server. The first export loads the encoder locally and can take longer on phones.

## Deploy to Cloudflare Pages

Use these Pages build settings:

- Build command: `npm run build`
- Build output directory: `dist/clinical-case-video/browser`
- Root directory: `/`
- Node.js version: `22.22.3` (also pinned in `.nvmrc`)

If `NODE_VERSION` is already set in the Cloudflare dashboard, update it to `22.22.3` as well.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` deploys on pushes to `main`. In the repository settings, set **Pages > Build and deployment > Source** to **GitHub Actions**. The workflow uses `npm run build:github`, which configures the `/edit-video-ap/` project-site path.
