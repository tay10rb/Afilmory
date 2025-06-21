import type { Logger } from '../logger/index.js'

// 存储对象的通用接口
export interface StorageObject {
  key: string
  size?: number
  lastModified?: Date
  etag?: string
}

// 存储提供商的通用接口
export interface StorageProvider {
  /**
   * 从存储中获取文件
   * @param key 文件的键值/路径
   * @param logger 可选的日志记录器
   * @returns 文件的 Buffer 数据，如果不存在则返回 null
   */
  getFile: (key: string, logger?: Logger['s3']) => Promise<Buffer | null>

  /**
   * 列出存储中的所有图片文件
   * @returns 图片文件对象数组
   */
  listImages: () => Promise<StorageObject[]>

  /**
   * 列出存储中的所有文件
   * @returns 所有文件对象数组
   */
  listAllFiles: () => Promise<StorageObject[]>

  /**
   * 生成文件的公共访问 URL
   * @param key 文件的键值/路径
   * @returns 公共访问 URL
   */
  generatePublicUrl: (key: string) => string

  /**
   * 检测 Live Photos 配对
   * @param allObjects 所有文件对象
   * @returns Live Photo 配对映射 (图片 key -> 视频对象)
   */
  detectLivePhotos: (allObjects: StorageObject[]) => Map<string, StorageObject>
}

export type S3Config = {
  provider: 's3'
  bucket?: string
  region?: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  prefix?: string
  customDomain?: string
  excludeRegex?: string
}

export type GitHubConfig = {
  provider: 'github'
  owner: string
  repo: string
  branch?: string
  token?: string
  path?: string
  useRawUrl?: boolean
}
export type StorageConfig = S3Config | GitHubConfig
