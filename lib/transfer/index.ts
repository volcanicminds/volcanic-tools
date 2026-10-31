import { AsyncLocalStorage } from 'node:async_hooks'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Server, EVENTS, ERRORS, Upload } from '@tus/server'
import { FileStore } from '@tus/file-store'
import { S3Store } from '@tus/s3-store'
import type { IncomingMessage, ServerResponse } from 'http'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** The metadata key an upload's owner is kept under: the manager writes it, a client cannot. */
const OWNER = 'owner'
/** The keys one DeleteObjects request of S3 takes at most. */
const S3_DELETE_BATCH = 1000

/** An error of a store that says the upload is not there (404) or no longer (410). */
const gone = (error: { status_code?: number }) => error?.status_code === 404 || error?.status_code === 410

/** An upload of a store, `undefined` when the store has none by that id. */
const findUpload = (store: { getUpload(id: string): Promise<Upload> }, id: string): Promise<Upload | undefined> =>
  store.getUpload(id).catch((error) => {
    if (gone(error)) return undefined
    throw error
  })

/** A whole number of milliseconds, 0 or more; `fallback` when absent. */
function milliseconds(name: string, value: number | undefined, fallback: number): number {
  const ms = value ?? fallback
  if (!Number.isSafeInteger(ms) || ms < 0) {
    throw new Error(`TransferManager: ${name} must be a whole number of milliseconds, 0 or more`)
  }
  return ms
}

/**
 * The file store, whose sweep tells the finished uploads from the unfinished ones. `@tus/file-store`
 * 2.0.0 judges an upload by the offset its configstore kept at creation, 0 for good, so it deletes
 * the finished ones too; the offset is the file's size, which `getUpload` reads. An unfinished
 * upload goes `getExpiration()` after its creation, a finished one `finishedExpiration` after its
 * last byte, the file's last write; 0 keeps them.
 */
class ExpiringFileStore extends FileStore {
  constructor(
    options: ConstructorParameters<typeof FileStore>[0],
    private readonly finishedExpiration: number
  ) {
    super(options)
  }

  async deleteExpired(): Promise<number> {
    if (!this.configstore.list) throw ERRORS.UNSUPPORTED_EXPIRATION_EXTENSION
    const now = Date.now()
    let deleted = 0
    for (const id of await this.configstore.list()) {
      const upload = await findUpload(this, id)
      if (!upload || !(await this.expired(upload, now))) continue
      await this.remove(id).then(
        () => deleted++,
        (error) => {
          if (!gone(error)) throw error
        }
      )
    }
    return deleted
  }

  private async expired(upload: Upload, now: number): Promise<boolean> {
    if (upload.size !== upload.offset) {
      const expiration = this.getExpiration()
      return expiration > 0 && !!upload.creation_date && now > new Date(upload.creation_date).getTime() + expiration
    }
    if (this.finishedExpiration <= 0) return false
    const written = await stat(join(this.directory, upload.id)).then(
      (file) => file.mtimeMs,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      }
    )
    return written !== undefined && now > written + this.finishedExpiration
  }
}

/**
 * The S3 store, whose sweep also deletes the finished uploads `finishedExpiration` after their
 * object was written; its own takes the unfinished ones alone, the multipart uploads still open.
 * Only what tus wrote goes: an object with the `.info` of its upload beside it, and that `.info`.
 * They are deleted directly, not through `remove`, which first aborts the upload's multipart
 * upload, long completed on a finished one.
 */
class ExpiringS3Store extends S3Store {
  constructor(
    options: ConstructorParameters<typeof S3Store>[0],
    private readonly finishedExpiration: number
  ) {
    super(options)
  }

  async deleteExpired(): Promise<number> {
    const unfinished = await super.deleteExpired()
    if (this.finishedExpiration <= 0) return unfinished
    const written = new Map<string, number>()
    let token: string | undefined
    do {
      const page = await this.client.listObjectsV2({ Bucket: this.bucket, ContinuationToken: token })
      for (const object of page.Contents ?? []) {
        if (object.Key && object.LastModified) written.set(object.Key, object.LastModified.getTime())
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    const now = Date.now()
    const expired = [...written]
      .filter(([key, at]) => written.has(this.infoKey(key)) && now > at + this.finishedExpiration)
      .map(([key]) => key)
    const keys = expired.flatMap((id) => [{ Key: id }, { Key: this.infoKey(id) }])
    for (let i = 0; i < keys.length; i += S3_DELETE_BATCH) {
      await this.client.deleteObjects({ Bucket: this.bucket, Delete: { Objects: keys.slice(i, i + S3_DELETE_BATCH) } })
    }
    await Promise.all(expired.map((id) => this.clearCache(id)))
    return unfinished + expired.length
  }
}

export interface TransferConfig {
  driver: 'local' | 's3'
  maxSize?: number // Bytes
  path: string // URL Path prefix (e.g. /files)
  /**
   * Milliseconds after its creation after which an unfinished upload is deleted. Default 24 hours;
   * `0` keeps them forever.
   */
  expireAfterMs?: number
  /**
   * Milliseconds after its last byte after which a finished upload is deleted. Default `0`: kept,
   * what becomes of it is the application's. For an application that moves every upload elsewhere
   * once finished, the ones it never came for. Both expiries are swept on the shorter of the two,
   * at most hourly.
   */
  expireFinishedAfterMs?: number

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
/**
 * A gate tus runs on every request it handles: the web `Request` `@tus/server` builds from the Node
 * one, and the upload's id (a fresh one on a creation). Throwing refuses the request.
 */
export type TransferValidator = (req: Request, uploadId: string) => Promise<void>
/** What `isValid` hands the check: the fields a Fastify request and a Node request share. */
export type TransferRequest = Pick<IncomingMessage, 'headers' | 'method' | 'url'>
export type AnonymousTransferCheck = (req: TransferRequest) => boolean | Promise<boolean>

export class TransferManager {
  private server: Server
  private config: TransferConfig
  private validator: TransferValidator | null = null
  private anonymousAccess: AnonymousTransferCheck | null = null
  /** The owner `handle` serves the request as; tus calls the hooks inside it, with no way to pass it. */
  private readonly owners = new AsyncLocalStorage<string | undefined>()
  private readonly sweep: NodeJS.Timeout | null = null

  constructor(config: TransferConfig) {
    const expireAfterMs = milliseconds('expireAfterMs', config.expireAfterMs, DAY)
    const expireFinishedAfterMs = milliseconds('expireFinishedAfterMs', config.expireFinishedAfterMs, 0)
    this.config = { ...config, expireAfterMs, expireFinishedAfterMs }
    const store = this.createStore()

    this.server = new Server({
      path: config.path,
      datastore: store,
      maxSize: config.maxSize,
      respectForwardedHeaders: true,
      // The owner is the request's, never the client's: one it sent under the key is dropped.
      onUploadCreate: async (_req, upload) => {
        const metadata = { ...upload.metadata }
        delete metadata[OWNER]
        const owner = this.owners.getStore()
        return { metadata: owner === undefined ? metadata : { ...metadata, [OWNER]: owner } }
      },
      onIncomingRequest: async (req, id) => {
        await this.checkOwner(id)
        if (this.validator) await this.validator(req, id)
      }
    })

    const periods = [expireAfterMs, expireFinishedAfterMs].filter((ms) => ms > 0)
    if (periods.length > 0) {
      this.sweep = setInterval(
        () => {
          this.cleanUpExpired().catch((error) => console.error('Transfer: expired uploads not swept:', error))
        },
        Math.min(...periods, HOUR)
      )
      this.sweep.unref()
    }
  }

  /**
   * An upload that has an owner answers as missing to anyone else, so its id opens nothing to
   * another subject. A request that creates one finds no upload under its fresh id, and passes.
   */
  private async checkOwner(id: string): Promise<void> {
    const upload = await findUpload(this.server.datastore, id)
    const owner = upload?.metadata?.[OWNER]
    if (owner != null && owner !== this.owners.getStore()) throw ERRORS.FILE_NOT_FOUND
  }

  /**
   * Deletes the unfinished uploads older than `expireAfterMs`, and the finished ones idle past
   * `expireFinishedAfterMs`; the sweep calls it on its own.
   */
  public cleanUpExpired(): Promise<number> {
    return this.server.cleanUpExpiredUploads()
  }

  /** Stops the sweep of expired uploads. */
  public close(): void {
    if (this.sweep) clearInterval(this.sweep)
  }

  public isImplemented(): boolean {
    return true
  }

  public setValidator(validator: TransferValidator) {
    this.validator = validator
  }

  /** The URL path the endpoint is mounted at; `@volcanicminds/backend` mounts it there. */
  public getPath(): string {
    return this.config.path
  }

  /**
   * Lets a request that carries no credential through `@volcanicminds/backend`'s authentication,
   * a signed upload link for instance. Without a check every such request is refused.
   */
  public setAnonymousAccess(check: AnonymousTransferCheck) {
    this.anonymousAccess = check
  }

  /** `@volcanicminds/backend` asks this only for a request that authenticated no subject. */
  public async isValid(req: TransferRequest): Promise<boolean> {
    if (!this.anonymousAccess) return false
    return (await this.anonymousAccess(req)) === true
  }

  private createStore() {
    if (this.config.driver === 'local') {
      if (!this.config.local?.directory) {
        throw new Error('TransferManager: Local driver requires "directory" path')
      }
      return new ExpiringFileStore(
        { directory: this.config.local.directory, expirationPeriodInMilliseconds: this.config.expireAfterMs },
        this.config.expireFinishedAfterMs ?? 0
      )
    }

    if (this.config.driver === 's3') {
      if (!this.config.s3) {
        throw new Error('TransferManager: S3 driver requires s3 config object')
      }

      const { endPoint, port, useSSL, accessKey, secretKey, bucket, region, partSize } = this.config.s3

      const protocol = useSSL ? 'https:' : 'http:'
      const endpointUrl = port ? `${protocol}//${endPoint}:${port}` : `${protocol}//${endPoint}`

      return new ExpiringS3Store(
        {
          partSize: partSize || 8 * 1024 * 1024,
          expirationPeriodInMilliseconds: this.config.expireAfterMs,
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
        },
        this.config.expireFinishedAfterMs ?? 0
      )
    }

    throw new Error(`TransferManager: Unsupported driver ${this.config.driver}`)
  }

  public getServer(): Server {
    return this.server
  }

  // Hook system wrappers with double casting (as unknown) to bypass TS structural check

  // POST_CREATE is emitted as (req, upload, url), with no response: one argument fewer than the
  // other two hooks, and in a different order. Read as (req, res, upload) it handed the consumer
  // the URL string where the Upload belongs, which no type could catch downstream because the
  // callback takes `Upload | string` for the sake of POST_TERMINATE.
  public onUploadCreate(callback: TransferEventCallback): void {
    this.server.on(EVENTS.POST_CREATE, (req, upload) => {
      callback(upload, req as unknown as IncomingMessage)
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

  /**
   * Serves a tus request as `owner`: an upload it creates is bound to the owner, and an upload
   * bound to another answers 404. Without an owner the request creates unbound uploads, which the
   * id alone opens, and reaches no bound one.
   */
  public handle(req: IncomingMessage, res: ServerResponse, owner?: string): Promise<void> {
    return this.owners.run(owner, () => this.server.handle(req, res))
  }
}
