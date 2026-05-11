import { Client, ClientOptions, ItemBucketMetadata, BucketItemStat } from 'minio'
import { Readable } from 'stream'

export interface StorageConfig {
  endPoint: string
  port: number
  useSSL: boolean
  accessKey: string
  secretKey: string
  bucket: string
  region?: string
  pathStyle?: boolean
}

export interface UploadOptions {
  size?: number
  contentType?: string
  metadata?: Record<string, string | number | boolean>
}

// Definizione manuale del tipo di ritorno di putObject
// Necessario perché @types/minio non esporta 'UploadedObjectInfo' o 'Result' pubblicamente
export interface UploadedObjectInfo {
  etag: string
  versionId: string | null
}

export class StorageManager {
  private client: Client
  private bucket: string
  private region: string

  constructor(config: StorageConfig) {
    this.bucket = config.bucket
    this.region = config.region || 'us-east-1'

    const clientOptions: ClientOptions = {
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: this.region,
      pathStyle: config.pathStyle
    }

    this.client = new Client(clientOptions)
  }

  public getClient(): Client {
    return this.client
  }

  public getBucketName(): string {
    return this.bucket
  }

  private validatePath(objectName: string): void {
    if (!objectName || objectName.trim() === '') {
      throw new Error('Object name cannot be empty')
    }

    if (
      objectName.includes('..') ||
      objectName.startsWith('/') ||
      objectName.startsWith('./') ||
      objectName.includes('\\')
    ) {
      throw new Error(`Invalid object name: ${objectName}`)
    }
  }

  public async verifyConnection(): Promise<boolean> {
    try {
      await this.client.listBuckets()
      return true
    } catch (error) {
      console.error('Storage connection verification failed:', error)
      return false
    }
  }

  public async ensureBucket(bucketName?: string): Promise<void> {
    const targetBucket = bucketName || this.bucket
    try {
      const exists = await this.client.bucketExists(targetBucket)
      if (!exists) {
        await this.client.makeBucket(targetBucket, this.region)
      }
    } catch (error) {
      throw new Error(`Failed to ensure bucket ${targetBucket}: ${error}`)
    }
  }

  public async uploadFile(
    objectName: string,
    stream: Readable | Buffer | string,
    options: UploadOptions = {}
  ): Promise<UploadedObjectInfo> {
    this.validatePath(objectName)
    await this.ensureBucket()

    const metaData = options.metadata || {}

    // Casting a any/Promise<UploadedObjectInfo> per compatibilità TS
    // putObject ritorna un oggetto compatibile con l'interfaccia definita sopra
    return this.client.putObject(
      this.bucket,
      objectName,
      stream,
      options.size,
      metaData as ItemBucketMetadata
    ) as Promise<UploadedObjectInfo>
  }

  public async getFileUrl(objectName: string, expiry: number = 24 * 60 * 60): Promise<string> {
    this.validatePath(objectName)
    return this.client.presignedGetObject(this.bucket, objectName, expiry)
  }

  public async getUploadUrl(objectName: string, expiry: number = 24 * 60 * 60): Promise<string> {
    this.validatePath(objectName)
    return this.client.presignedPutObject(this.bucket, objectName, expiry)
  }

  public async deleteFile(objectName: string): Promise<void> {
    this.validatePath(objectName)
    await this.client.removeObject(this.bucket, objectName)
  }

  public async deleteFiles(objectNames: string[]): Promise<void> {
    objectNames.forEach((name) => this.validatePath(name))
    await this.client.removeObjects(this.bucket, objectNames)
  }

  public async fileExists(objectName: string): Promise<boolean> {
    this.validatePath(objectName)
    try {
      await this.client.statObject(this.bucket, objectName)
      return true
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'NotFound') {
        return false
      }
      throw error
    }
  }

  public async getFileStream(objectName: string): Promise<Readable> {
    this.validatePath(objectName)
    return this.client.getObject(this.bucket, objectName)
  }

  public async getFileStat(objectName: string): Promise<BucketItemStat> {
    this.validatePath(objectName)
    return this.client.statObject(this.bucket, objectName)
  }
}
