import { i18nAtom } from '~/i18n'
import { jotaiStore } from '~/lib/jotai'
import { LRUCache } from '~/lib/lru-cache'
import {
  convertMovToMp4,
  isVideoConversionSupported,
  needsVideoConversion,
} from '~/lib/video-converter'

export interface LoadingState {
  isVisible: boolean
  isHeicFormat?: boolean
  loadingProgress?: number
  loadedBytes?: number
  totalBytes?: number
  isConverting?: boolean
  conversionMessage?: string
  codecInfo?: string
}

export interface LoadingCallbacks {
  onProgress?: (progress: number) => void
  onError?: () => void
  onLoadingStateUpdate?: (state: Partial<LoadingState>) => void
}

export interface ImageLoadResult {
  blobSrc: string
  convertedUrl?: string
}

export interface VideoProcessResult {
  convertedVideoUrl?: string
  conversionMethod?: string
}

export interface ImageCacheResult {
  blobSrc: string
  originalSize: number
  format: string
}

// Regular image cache using LRU cache
const regularImageCache: LRUCache<string, ImageCacheResult> = new LRUCache<
  string,
  ImageCacheResult
>(
  10, // Cache size for regular images
  (value, key, reason) => {
    try {
      URL.revokeObjectURL(value.blobSrc)
      console.info(`Regular image cache: Revoked blob URL - ${reason}`)
    } catch (error) {
      console.warn(
        `Failed to revoke regular image blob URL (${reason}):`,
        error,
      )
    }
  },
)

/**
 * 生成普通图片的缓存键
 */
function generateRegularImageCacheKey(url: string): string {
  // 使用原始 URL 作为唯一键
  return url
}

export class ImageLoaderManager {
  private currentXHR: XMLHttpRequest | null = null
  private delayTimer: NodeJS.Timeout | null = null

  /**
   * 验证 Blob 是否为有效的图片格式
   */
  private isValidImageBlob(blob: Blob): boolean {
    // 检查 MIME 类型
    const validImageTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/bmp',
      'image/tiff',
      'image/heic',
      'image/heif',
    ]

    // 检查 Content-Type
    if (!blob.type || !validImageTypes.includes(blob.type.toLowerCase())) {
      console.warn(`Invalid image MIME type: ${blob.type}`)
      return false
    }

    // 检查文件大小（至少应该有一些字节）
    if (blob.size === 0) {
      console.warn('Empty blob detected')
      return false
    }

    return true
  }

  async loadImage(
    src: string,
    callbacks: LoadingCallbacks = {},
  ): Promise<ImageLoadResult> {
    const { onProgress, onError, onLoadingStateUpdate } = callbacks

    // Show loading indicator
    onLoadingStateUpdate?.({
      isVisible: true,
    })

    return new Promise((resolve, reject) => {
      this.delayTimer = setTimeout(async () => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', src)
        xhr.responseType = 'blob'

        xhr.onload = async () => {
          if (xhr.status === 200) {
            try {
              // 验证响应是否为图片
              const blob = xhr.response as Blob
              if (!this.isValidImageBlob(blob)) {
                onLoadingStateUpdate?.({
                  isVisible: false,
                })
                onError?.()
                reject(new Error('Response is not a valid image'))
                return
              }

              const result = await this.processImageBlob(
                blob,
                src, // 传递原始 URL
                callbacks,
              )
              resolve(result)
            } catch (error) {
              onLoadingStateUpdate?.({
                isVisible: false,
              })
              onError?.()
              reject(error)
            }
          } else {
            onLoadingStateUpdate?.({
              isVisible: false,
            })
            onError?.()
            reject(new Error(`HTTP ${xhr.status}`))
          }
        }

        xhr.onprogress = (e) => {
          if (e.lengthComputable) {
            const progress = (e.loaded / e.total) * 100

            // Update loading progress
            onLoadingStateUpdate?.({
              loadingProgress: progress,
              loadedBytes: e.loaded,
              totalBytes: e.total,
            })

            onProgress?.(progress)
          }
        }

        xhr.onerror = () => {
          // Hide loading indicator on error
          onLoadingStateUpdate?.({
            isVisible: false,
          })

          onError?.()
          reject(new Error('Network error'))
        }

        xhr.send()
        this.currentXHR = xhr
      }, 300)
    })
  }

  async processLivePhotoVideo(
    livePhotoVideoUrl: string,
    videoElement: HTMLVideoElement,
    callbacks: LoadingCallbacks = {},
  ): Promise<VideoProcessResult> {
    const { onLoadingStateUpdate } = callbacks

    return new Promise((resolve, reject) => {
      const processVideo = async () => {
        try {
          // 检查是否需要转换
          if (needsVideoConversion(livePhotoVideoUrl)) {
            const result = await this.convertVideo(
              livePhotoVideoUrl,
              videoElement,
              callbacks,
            )
            resolve(result)
          } else {
            const result = await this.loadDirectVideo(
              livePhotoVideoUrl,
              videoElement,
            )
            resolve(result)
          }
        } catch (error) {
          console.error('Failed to process Live Photo video:', error)
          onLoadingStateUpdate?.({
            isVisible: false,
          })
          reject(error)
        }
      }

      // 异步处理视频，不阻塞图片显示
      processVideo()
    })
  }

  private async processImageBlob(
    blob: Blob,
    originalUrl: string, // 添加原始 URL 参数
    callbacks: LoadingCallbacks,
  ): Promise<ImageLoadResult> {
    const { onError: _onError, onLoadingStateUpdate } = callbacks

    try {
      // 动态导入 heic-converter 模块
      const { detectHeicFormat, isBrowserSupportHeic } = await import(
        '~/lib/heic-converter'
      )

      // 检测是否为 HEIC 格式
      const shouldHeicTransformed =
        !isBrowserSupportHeic() && (await detectHeicFormat(blob))

      // Update loading indicator with HEIC format info
      onLoadingStateUpdate?.({
        isHeicFormat: shouldHeicTransformed,
        loadingProgress: 100,
        loadedBytes: blob.size,
        totalBytes: blob.size,
      })

      if (shouldHeicTransformed) {
        return await this.processHeicImage(blob, originalUrl, callbacks)
      } else {
        return this.processRegularImage(blob, originalUrl, callbacks) // 传递原始 URL
      }
    } catch (detectionError) {
      console.error('Format detection failed:', detectionError)
      // 如果检测失败，按普通图片处理
      return this.processRegularImage(blob, originalUrl, callbacks) // 传递原始 URL
    }
  }

  private async processHeicImage(
    blob: Blob,
    originalUrl: string,
    callbacks: LoadingCallbacks,
  ): Promise<ImageLoadResult> {
    const { onError: _onError, onLoadingStateUpdate } = callbacks

    // 如果是 HEIC 格式，进行转换
    const i18n = jotaiStore.get(i18nAtom)
    onLoadingStateUpdate?.({
      isConverting: true,
      conversionMessage: i18n.t('loading.heic.converting'),
    })

    try {
      // 动态导入 heic-converter 模块
      const { convertHeicImage } = await import('~/lib/heic-converter')

      const conversionResult = await convertHeicImage(blob, originalUrl)

      // Hide loading indicator
      onLoadingStateUpdate?.({
        isVisible: false,
      })

      console.info(
        `HEIC converted: ${(blob.size / 1024).toFixed(1)}KB → ${(conversionResult.convertedSize / 1024).toFixed(1)}KB`,
      )

      return {
        blobSrc: conversionResult.url,
        convertedUrl: conversionResult.url,
      }
    } catch (conversionError) {
      console.error('HEIC conversion failed:', conversionError)

      // Hide loading indicator on error
      onLoadingStateUpdate?.({
        isVisible: false,
      })

      _onError?.()
      throw conversionError
    }
  }

  private processRegularImage(
    blob: Blob,
    originalUrl: string, // 添加原始 URL 参数
    callbacks: LoadingCallbacks,
  ): ImageLoadResult {
    const { onLoadingStateUpdate } = callbacks

    // 生成缓存键
    const cacheKey = generateRegularImageCacheKey(originalUrl) // 使用原始 URL

    // 检查缓存
    const cachedResult = regularImageCache.get(cacheKey)
    if (cachedResult) {
      console.info('Using cached regular image result', cachedResult)

      // Hide loading indicator
      onLoadingStateUpdate?.({
        isVisible: false,
      })

      return {
        blobSrc: cachedResult.blobSrc,
      }
    }

    // 普通图片格式
    const url = URL.createObjectURL(blob)

    const result: ImageCacheResult = {
      blobSrc: url,
      originalSize: blob.size,
      format: blob.type,
    }

    // 缓存结果
    regularImageCache.set(cacheKey, result)
    console.info(
      `Regular image processed and cached: ${(blob.size / 1024).toFixed(1)}KB, URL: ${originalUrl}`,
    )

    // Hide loading indicator
    onLoadingStateUpdate?.({
      isVisible: false,
    })

    return {
      blobSrc: url,
    }
  }

  private async convertVideo(
    livePhotoVideoUrl: string,
    videoElement: HTMLVideoElement,
    callbacks: LoadingCallbacks,
  ): Promise<VideoProcessResult> {
    const { onLoadingStateUpdate } = callbacks

    // 检查浏览器是否支持视频转换
    if (!isVideoConversionSupported()) {
      console.warn('Video conversion not supported in this browser')
      return {}
    }

    // 更新加载指示器显示转换进度
    onLoadingStateUpdate?.({
      isVisible: true,
      isConverting: true,
      loadingProgress: 0,
    })

    console.info('Converting MOV video to MP4...')

    const i18n = jotaiStore.get(i18nAtom)

    const result = await convertMovToMp4(livePhotoVideoUrl, (progress) => {
      // 检查是否包含编码器信息（支持多语言）
      const codecKeywords: string[] = [
        i18n.t('video.codec.keyword'), // 翻译键
        'encoder',
        'codec',
        '编码器', // 备用关键词
      ]
      const isCodecInfo = codecKeywords.some((keyword: string) =>
        progress.message.toLowerCase().includes(keyword.toLowerCase()),
      )

      onLoadingStateUpdate?.({
        isVisible: true,
        isConverting: progress.isConverting,
        loadingProgress: progress.progress,
        conversionMessage: progress.message,
        codecInfo: isCodecInfo ? progress.message : undefined,
      })
    })

    if (result.success && result.videoUrl) {
      const convertedVideoUrl = result.videoUrl
      const conversionMethod = result.method || 'unknown'

      videoElement.src = result.videoUrl
      videoElement.load()

      console.info(
        `Video conversion completed using ${result.method}. Size: ${result.convertedSize ? Math.round(result.convertedSize / 1024) : 'unknown'}KB`,
      )

      onLoadingStateUpdate?.({
        isVisible: false,
      })

      return new Promise((resolve) => {
        const handleVideoCanPlay = () => {
          videoElement.removeEventListener('canplaythrough', handleVideoCanPlay)
          resolve({
            convertedVideoUrl,
            conversionMethod,
          })
        }

        videoElement.addEventListener('canplaythrough', handleVideoCanPlay)
      })
    } else {
      console.error('Video conversion failed:', result.error)
      onLoadingStateUpdate?.({
        isVisible: false,
      })
      throw new Error(result.error || 'Video conversion failed')
    }
  }

  private async loadDirectVideo(
    livePhotoVideoUrl: string,
    videoElement: HTMLVideoElement,
  ): Promise<VideoProcessResult> {
    // 直接使用原始视频
    videoElement.src = livePhotoVideoUrl
    videoElement.load()

    return new Promise((resolve) => {
      const handleVideoCanPlay = () => {
        videoElement.removeEventListener('canplaythrough', handleVideoCanPlay)
        resolve({
          conversionMethod: '',
        })
      }

      videoElement.addEventListener('canplaythrough', handleVideoCanPlay)
    })
  }

  cleanup() {
    // 清理定时器
    if (this.delayTimer) {
      clearTimeout(this.delayTimer)
      this.delayTimer = null
    }

    // 取消正在进行的请求
    if (this.currentXHR) {
      this.currentXHR.abort()
      this.currentXHR = null
    }
  }
}

// Regular image cache management functions
export function getRegularImageCacheSize(): number {
  return regularImageCache.size()
}

export function clearRegularImageCache(): void {
  regularImageCache.clear()
}

export function removeRegularImageCache(cacheKey: string): boolean {
  return regularImageCache.delete(cacheKey)
}

export function getRegularImageCacheStats(): {
  size: number
  maxSize: number
  keys: string[]
} {
  return regularImageCache.getStats()
}

/**
 * 根据原始 URL 移除特定的普通图片缓存项
 */
export function removeRegularImageCacheByUrl(originalUrl: string): boolean {
  const cacheKey = generateRegularImageCacheKey(originalUrl)
  return regularImageCache.delete(cacheKey)
}
