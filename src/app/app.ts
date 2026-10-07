import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';

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
  videoFormat = '';
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
      const scale = Math.min(1, 1280 / Math.max(sourceWidth, sourceHeight));
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

    if (typeof VideoEncoder !== 'function') {
      this.downloadError = 'This browser cannot encode MP4. Please use an updated Safari or Chrome browser.';
      this.editorOpen = true;
      return;
    }

    if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
    this.videoUrl = '';
    this.videoFilename = '';
    this.videoFormat = '';
    this.isDownloading = true;
    this.downloadError = '';
    this.exportStatus = 'Preparing the three photos…';
    this.changeDetector.detectChanges();
    window.clearInterval(this.timer);

    try {
      const images = await Promise.all(this.photos.map((photo) => this.loadPhoto(photo.src)));
      const canvas = document.createElement('canvas');
      canvas.width = 432;
      canvas.height = 768;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Could not prepare the video canvas.');

      const target = new BufferTarget();
      const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('low') });
      const output = new Output({ format: new Mp4OutputFormat(), target });
      output.addVideoTrack(source);
      await output.start();

      const slideDuration = 4;
      for (let index = 0; index < images.length; index++) {
        this.drawPhoto(context, images[index]);
        this.exportStatus = `Encoding photo ${index + 1} of ${images.length}…`;
        this.changeDetector.detectChanges();
        await source.add(index * slideDuration, slideDuration);
      }

      await output.finalize();
      if (!target.buffer) throw new Error('MP4 encoding produced an empty file.');
      const video = new Blob([target.buffer], { type: 'video/mp4' });
      this.videoUrl = URL.createObjectURL(video);
      this.videoFormat = 'MP4';
      this.videoFilename = `${this.caseName.trim().replace(/[^a-z0-9]+/gi, '-') || 'clinical-case'}.mp4`;
      this.exportStatus = 'Video ready. Tap Download MP4 to save it.';
      this.changeDetector.detectChanges();
    } catch (error) {
      console.error('MP4 export failed', error);
      this.downloadError = error instanceof Error ? error.message : 'Video creation failed. Please try again.';
      this.exportStatus = '';
      this.editorOpen = true;
      this.changeDetector.detectChanges();
    } finally {
      this.isDownloading = false;
      if (!this.editorOpen) this.startAutoplay();
      this.changeDetector.detectChanges();
    }
  }

  onVideoDownloadStarted(): void {
    this.exportStatus = 'Download started.';
  }

  private async loadPhoto(src: string): Promise<HTMLImageElement> {
    const image = new Image();
    image.src = src;
    await image.decode();
    return image;
  }

  private drawPhoto(context: CanvasRenderingContext2D, image: HTMLImageElement): void {
    const width = 432;
    const height = 768;
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  private startAutoplay(): void {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (!this.editorOpen && !this.isDownloading) this.showSlide(this.currentSlide + 1);
    }, 6000);
  }
}
