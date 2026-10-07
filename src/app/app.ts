import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import html2canvas from 'html2canvas';

interface ClinicalPhoto {
  title: string;
  fileName: string;
  src: string;
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

  caseName = 'Leukoplakia';
  healingDays = 11;
  currentSlide = 0;
  editorOpen = true;
  isDownloading = false;
  exportStatus = '';
  downloadError = '';
  photos: ClinicalPhoto[] = [
    { title: 'Pre-Operative', fileName: '', src: '' },
    { title: 'Post-Operative', fileName: '', src: '' },
    { title: 'Healing After 11 Days', fileName: '', src: '' },
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

  onImageSelected(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.downloadError = 'Choose an image file for each clinical photo.';
      input.value = '';
      return;
    }

    const oldSource = this.photos[index].src;
    if (oldSource.startsWith('blob:')) URL.revokeObjectURL(oldSource);
    this.photos[index] = {
      ...this.photos[index],
      fileName: file.name,
      src: URL.createObjectURL(file),
    };
    this.downloadError = '';
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
    this.isDownloading = true;
    this.downloadError = '';
    this.exportStatus = 'Preparing video…';
    this.changeDetector.detectChanges();
    window.clearInterval(this.timer);

    try {
      const encoder = await this.getEncoder();
      const frameFiles: string[] = [];
      await document.fonts.ready;

      for (let index = 0; index < slides.length; index++) {
        this.currentSlide = index;
        slides.forEach((slide, slideIndex) => {
          slide.style.display = slideIndex === index ? 'flex' : 'none';
        });
        await this.nextFrame();
        const image = slides[index].querySelector('img');
        if (image?.decode) await image.decode();

        this.exportStatus = `Capturing slide ${index + 1} of ${slides.length}…`;
        this.changeDetector.detectChanges();
        const canvas = await html2canvas(slides[index], {
          backgroundColor: '#f8fbff',
          logging: false,
          scale: Math.min(2, 900 / slides[index].clientWidth),
        });
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
      await encoder.exec([
        '-y', '-f', 'concat', '-safe', '0', '-i', 'slides.txt',
        '-vf', 'fps=24,scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25', '-movflags', '+faststart', 'case-video.mp4',
      ]);

      const result = await encoder.readFile('case-video.mp4');
      if (typeof result === 'string') throw new Error('The video encoder returned an invalid file.');
      const video = new Blob([new Uint8Array(result)], { type: 'video/mp4' });
      const url = URL.createObjectURL(video);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.caseName.trim().replace(/[^a-z0-9]+/gi, '-') || 'clinical-case'}.mp4`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      this.exportStatus = 'MP4 downloaded.';
      this.changeDetector.detectChanges();
    } catch (error) {
      console.error('MP4 export failed', error);
      this.downloadError = 'MP4 export failed. Try smaller photos or a newer browser.';
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
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }

  private startAutoplay(): void {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (!this.editorOpen && !this.isDownloading) this.showSlide(this.currentSlide + 1);
    }, 6000);
  }
}
