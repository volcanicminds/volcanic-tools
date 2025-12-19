import { Server, EVENTS, Upload } from '@tus/server'
import { FileStore } from '@tus/file-store'
import { S3Store } from '@tus/s3-store'
import type { IncomingMessage, ServerResponse } from 'http'

export interface TransferConfig {
  driver: 'local' | 's3'
  maxSize?: number // Bytes
  path: string // URL Path prefix (e.g. /files)

  // Local Config
  local?: {
    directory: string
  }

  // S3/Minio Config
  s3?: {
    bucket: string
    endPoint: string
    port?: number
    useSSL?: boolean
    accessKey: string
    secretKey: string
    region?: string
    partSize?: number // Minimum 5MB for S3
  }
}

export type TransferEventCallback = (uploadOrId: Upload | string, req?: IncomingMessage, res?: ServerResponse) => void
export type TransferValidator = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export class TransferManager {
  private server: Server
  private config: TransferConfig
  private validator: TransferValidator | null = null

  constructor(config: TransferConfig) {
    this.config = config
    const store = this.createStore()

    this.server = new Server({
      path: config.path,
      datastore: store,
      maxSize: config.maxSize,
      respectForwardedHeaders: true,
      onIncomingRequest: async (req, res) => {
        if (this.validator) {
          await this.validator(req as unknown as IncomingMessage, res as unknown as ServerResponse)
        }
      }
    })
  }

  public isImplemented(): boolean {
    return true
  }

  public setValidator(validator: TransferValidator) {
    this.validator = validator
  }

  private createStore() {
    if (this.config.driver === 'local') {
      if (!this.config.local?.directory) {
        throw new Error('TransferManager: Local driver requires "directory" path')
      }
      return new FileStore({
        directory: this.config.local.directory
      })
    }

    if (this.config.driver === 's3') {
      if (!this.config.s3) {
        throw new Error('TransferManager: S3 driver requires s3 config object')
      }

      const { endPoint, port, useSSL, accessKey, secretKey, bucket, region, partSize } = this.config.s3

      const protocol = useSSL ? 'https:' : 'http:'
      const endpointUrl = port ? `${protocol}//${endPoint}:${port}` : `${protocol}//${endPoint}`

      return new S3Store({
        partSize: partSize || 8 * 1024 * 1024,
        s3ClientConfig: {
          bucket: bucket, // Required inside s3ClientConfig by @tus/s3-store types
          region: region || 'us-east-1',
          endpoint: endpointUrl,
          credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey
          },
          forcePathStyle: true
        }
      })
    }

    throw new Error(`TransferManager: Unsupported driver ${this.config.driver}`)
  }

  public getServer(): Server {
    return this.server
  }

  // Hook system wrappers with double casting (as unknown) to bypass TS structural check

  public onUploadCreate(callback: TransferEventCallback): void {
    this.server.on(EVENTS.POST_CREATE, (req, res, upload) => {
      callback(upload, req as unknown as IncomingMessage, res as unknown as ServerResponse)
    })
  }

  public onUploadFinish(callback: TransferEventCallback): void {
    this.server.on(EVENTS.POST_FINISH, (req, res, upload) => {
      callback(upload, req as unknown as IncomingMessage, res as unknown as ServerResponse)
    })
  }

  public onUploadTerminate(callback: TransferEventCallback): void {
    // Note: POST_TERMINATE passes 'id' (string) instead of 'upload' object in recent tus versions
    this.server.on(EVENTS.POST_TERMINATE, (req, res, id) => {
      callback(id, req as unknown as IncomingMessage, res as unknown as ServerResponse)
    })
  }

  // Handle Request helper
  public handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.server.handle(req, res)
  }
}
