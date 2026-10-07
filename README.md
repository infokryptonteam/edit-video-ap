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
