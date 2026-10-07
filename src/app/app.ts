import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import html2canvas from 'html2canvas';

interface ClinicalPhoto {
  title: string;
  fileName: string;
  src: string;
  processing: boolean;
}

@Component({
  imports: [FormsModule],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './video-editor.html',
})
export class App implements OnInit, OnDestroy {
  private readonly changeDetector = inject(ChangeDetectorRef);
  private encoder: FFmpeg | null = null;
  private encoderReady: Promise<boolean> | null = null;
  private timer: number | undefined;
  private touchStartX = 0;
  private photoLoadIds = [0, 0, 0];
  private photoOptimizationQueue: Promise<void> = Promise.resolve();

  caseName = 'Leukoplakia';
  healingDays = 11;
  currentSlide = 0;
  editorOpen = true;
  isDownloading = false;
  exportStatus = '';
  downloadError = '';
  videoUrl = '';
  videoFilename = '';
  photos: ClinicalPhoto[] = [
    { title: 'Pre-Operative', fileName: '', src: '', processing: false },
    { title: 'Post-Operative', fileName: '', src: '', processing: false },
    { title: 'Healing After 11 Days', fileName: '', src: '', processing: false },
  ];

  get allPhotosSelected(): boolean {
    return this.photos.every((photo) => Boolean(photo.src));
  }

  ngOnInit(): void {
    this.startAutoplay();
  }

  ngOnDestroy(): void {
    window.clearInterval(this.timer);
    for (const photo of this.photos) {
      if (photo.src.startsWith('blob:')) URL.revokeObjectURL(photo.src);
    }
    if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
    this.encoder?.terminate();
  }

  showSlide(index: number): void {
    const slideCount = this.photos.length + 2;
    this.currentSlide = (index + slideCount) % slideCount;
  }

  openEditor(): void {
    this.editorOpen = true;
  }

  closeEditor(): void {
    this.editorOpen = false;
    this.startAutoplay();
  }

  showPresentation(): void {
    this.showSlide(0);
    this.closeEditor();
  }

  setHealingDays(value: number | string): void {
    const days = Number(value);
    this.healingDays = Math.min(365, Math.max(1, Math.round(days || 1)));
    this.photos[2].title = `Healing After ${this.healingDays} Days`;
  }

  async onImageSelected(event: Event, index: number): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.downloadError = 'Choose an image file for each clinical photo.';
      input.value = '';
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      this.downloadError = 'This photo is over 50 MB. Please resize it or choose a smaller copy.';
      input.value = '';
      return;
    }

    const loadId = ++this.photoLoadIds[index];
    const oldSource = this.photos[index].src;
    if (oldSource.startsWith('blob:')) URL.revokeObjectURL(oldSource);
    this.photos[index] = {
      ...this.photos[index],
      fileName: file.name,
      src: '',
      processing: true,
    };
    this.downloadError = '';
    const optimization = this.photoOptimizationQueue.catch(() => undefined).then(async () => {
      if (this.photoLoadIds[index] !== loadId) return;
      const optimized = await this.optimizePhoto(file);
      if (this.photoLoadIds[index] !== loadId) return;
      this.photos[index] = {
        ...this.photos[index],
        src: URL.createObjectURL(optimized),
        processing: false,
      };
      this.changeDetector.detectChanges();
    });
    this.photoOptimizationQueue = optimization.catch(() => undefined);
    try {
      await optimization;
    } catch (error) {
      console.error('Photo optimization failed', error);
      if (this.photoLoadIds[index] !== loadId) return;
      this.photos[index] = { ...this.photos[index], fileName: '', processing: false };
      this.downloadError = 'This photo format could not be opened. Please choose a JPG, PNG, or WebP image.';
      input.value = '';
      this.changeDetector.detectChanges();
    }
  }

  private async optimizePhoto(file: File): Promise<Blob> {
    let bitmap: ImageBitmap | null = null;
    let image: HTMLImageElement | null = null;
    let sourceUrl = '';
    try {
      if (typeof createImageBitmap === 'function') {
        try {
          bitmap = await createImageBitmap(file);
        } catch {
          bitmap = null;
        }
      }
      if (!bitmap) {
        sourceUrl = URL.createObjectURL(file);
        image = new Image();
        image.decoding = 'async';
        image.src = sourceUrl;
        await image.decode();
      }

      const source: CanvasImageSource = bitmap ?? image!;
      const sourceWidth = bitmap?.width ?? image!.naturalWidth;
      const sourceHeight = bitmap?.height ?? image!.naturalHeight;
      const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas is unavailable.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const optimized = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not compress photo.')), 'image/jpeg', 0.84);
      });
      return scale < 1 || optimized.size < file.size ? optimized : file;
    } finally {
      bitmap?.close();
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    }
  }

  onTouchStart(event: TouchEvent): void {
    this.touchStartX = event.touches[0]?.clientX ?? 0;
  }

  onTouchEnd(event: TouchEvent): void {
    if (this.editorOpen || !event.changedTouches[0]) return;
    const distance = event.changedTouches[0].clientX - this.touchStartX;
    if (Math.abs(distance) > 45) this.showSlide(this.currentSlide + (distance < 0 ? 1 : -1));
  }

  async downloadMp4(): Promise<void> {
    if (!this.allPhotosSelected) {
      this.downloadError = 'Upload all three clinical photos before downloading.';
      this.editorOpen = true;
      return;
    }

    const slides = Array.from(document.querySelectorAll<HTMLElement>('#app #slides .slide'));
    const originalDisplays = slides.map((slide) => slide.style.display);
    const previousSlide = this.currentSlide;
    if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
    this.videoUrl = '';
    this.videoFilename = '';
    this.isDownloading = true;
    this.downloadError = '';
    this.exportStatus = 'Preparing video…';
    this.changeDetector.detectChanges();
    window.clearInterval(this.timer);

    try {
      const encoder = await this.withTimeout(this.getEncoder(), 120_000, 'Encoder startup');
      const frameFiles: string[] = [];
      await this.withTimeout(document.fonts.ready, 15_000, 'Font loading');

      for (let index = 0; index < slides.length; index++) {
        this.currentSlide = index;
        slides.forEach((slide, slideIndex) => {
          slide.style.display = slideIndex === index ? 'flex' : 'none';
        });
        await this.nextFrame();
        if (!slides[index].clientWidth || !slides[index].clientHeight) {
          throw new Error('Presentation layout is not visible. Keep the app open while creating the video.');
        }
        const image = slides[index].querySelector('img');
        if (image?.decode) await image.decode();

        this.exportStatus = `Capturing slide ${index + 1} of ${slides.length}…`;
        this.changeDetector.detectChanges();
        const canvas = await this.withTimeout(html2canvas(slides[index], {
          backgroundColor: '#f8fbff',
          logging: false,
          scale: Math.min(2, 540 / slides[index].clientWidth),
        }), 45_000, 'Slide capture');
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((result) => result ? resolve(result) : reject(new Error(`Could not capture slide ${index + 1} (${canvas.width}x${canvas.height}).`)), 'image/jpeg', 0.92);
        });
        const fileName = `slide-${index}.jpg`;
        await encoder.writeFile(fileName, new Uint8Array(await blob.arrayBuffer()));
        frameFiles.push(fileName);
      }

      const concatList = frameFiles.map((file) => `file '${file}'\nduration 3`).join('\n') + `\nfile '${frameFiles[frameFiles.length - 1]}'\n`;
      await encoder.writeFile('slides.txt', new TextEncoder().encode(concatList));
      this.exportStatus = 'Encoding MP4…';
      this.changeDetector.detectChanges();
      const exitCode = await encoder.exec([
        '-y', '-f', 'concat', '-safe', '0', '-i', 'slides.txt',
        '-vf', 'fps=24,scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25', '-movflags', '+faststart', 'case-video.mp4',
      ], 180_000);
      if (exitCode !== 0) throw new Error('MP4 encoding timed out or failed.');

      const result = await encoder.readFile('case-video.mp4');
      if (typeof result === 'string') throw new Error('The video encoder returned an invalid file.');
      const video = new Blob([new Uint8Array(result)], { type: 'video/mp4' });
      this.videoUrl = URL.createObjectURL(video);
      this.videoFilename = `${this.caseName.trim().replace(/[^a-z0-9]+/gi, '-') || 'clinical-case'}.mp4`;
      this.exportStatus = 'Video ready. Tap Download MP4 to save it.';
      this.changeDetector.detectChanges();
    } catch (error) {
      console.error('MP4 export failed', error);
      const message = error instanceof Error ? error.message : '';
      this.downloadError = message.includes('visible')
        ? 'Keep this page open while creating the video, then try again.'
        : message.includes('timed out') || message.includes('failed')
          ? 'Video creation took too long or failed. Try smaller photos or another browser.'
          : 'MP4 export failed. Try smaller photos or another browser.';
      this.exportStatus = '';
      this.editorOpen = true;
      this.changeDetector.detectChanges();
    } finally {
      slides.forEach((slide, index) => {
        slide.style.display = originalDisplays[index];
      });
      this.currentSlide = previousSlide;
      this.isDownloading = false;
      if (!this.editorOpen) this.startAutoplay();
      this.changeDetector.detectChanges();
    }
  }

  onVideoDownloadStarted(): void {
    this.exportStatus = 'Download started.';
  }

  private async getEncoder(): Promise<FFmpeg> {
    if (!this.encoder) {
      this.encoder = new FFmpeg();
      this.encoder.on('progress', ({ progress }) => {
        const percentage = Math.round(Math.max(0, Math.min(99, Number.isFinite(progress) ? progress * 100 : 0)));
        this.exportStatus = `Encoding MP4… ${percentage}%`;
        this.changeDetector.detectChanges();
      });
    }
    if (!this.encoderReady) {
      const assets = new URL('ffmpeg/', document.baseURI);
      this.encoderReady = this.encoder.load({
        coreURL: new URL('ffmpeg-core.js', assets).href,
        wasmURL: new URL('ffmpeg-core.wasm', assets).href,
      });
    }
    try {
      await this.encoderReady;
    } catch (error) {
      this.encoderReady = null;
      throw error;
    }
    return this.encoder;
  }

  private nextFrame(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let fallback: number;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(fallback);
        resolve();
      };
      fallback = window.setTimeout(finish, 100);
      requestAnimationFrame(() => requestAnimationFrame(finish));
    });
  }

  private withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeout: number;
    return Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]).finally(() => window.clearTimeout(timeout));
  }

  private startAutoplay(): void {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (!this.editorOpen && !this.isDownloading) this.showSlide(this.currentSlide + 1);
    }, 6000);
  }
}
