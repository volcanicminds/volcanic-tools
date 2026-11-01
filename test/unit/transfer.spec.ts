/* eslint-disable @typescript-eslint/no-explicit-any */
//
// TransferManager: the resumable upload endpoint (tus), wrapped.
//
// The wrapper owns six things, and each of them is a place where a mistake is silent rather
// than loud: which store a driver builds, what happens to a request before tus sees it (the
// authorization gate), whose an upload is, when one left behind goes, the arguments a
// consumer's hook receives, and the refusals when the configuration cannot produce a store at
// all. Nothing leaves the machine: the local driver writes into a temporary directory, the owner
// is tested over HTTP on the loopback, and the S3 store builds its client without talking to
// anything.
//
import { expect } from 'expect'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { createServer, type Server as HttpServer } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { S3 as S3Client } from '@aws-sdk/client-s3'
import { EVENTS, Upload } from '@tus/server'
import { TransferManager } from '../../lib/transfer/index.js'

const S3 = {
  bucket: 'uploads',
  endPoint: 'minio.test',
  port: 9000,
  useSSL: false,
  accessKey: 'key',
  secretKey: 'secret'
}

let directory: string

describe('TransferManager', () => {
  before(() => {
    directory = mkdtempSync(join(tmpdir(), 'volcanic-transfer-'))
  })
  after(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  const local = (over: any = {}) => new TransferManager({ driver: 'local', path: '/files', local: { directory }, ...over })

  describe('the store a configuration produces', () => {
    it('builds a local store on the directory it was given', () => {
      const manager = local()
      expect(manager.isImplemented()).toBe(true)
      const server: any = manager.getServer()
      expect(server.options.path).toBe('/files')
      expect(server.datastore).toBeDefined()
    })

    it('carries the size limit to the server, where tus enforces it', () => {
      const server: any = local({ maxSize: 1024 }).getServer()
      expect(server.options.maxSize).toBe(1024)
    })

    it('refuses a local driver with no directory, instead of writing somewhere else', () => {
      expect(() => new TransferManager({ driver: 'local', path: '/files' } as any)).toThrow(/requires "directory" path/)
      expect(() => new TransferManager({ driver: 'local', path: '/files', local: {} } as any)).toThrow(
        /requires "directory" path/
      )
    })

    it('refuses an S3 driver with no S3 configuration', () => {
      expect(() => new TransferManager({ driver: 's3', path: '/files' } as any)).toThrow(/requires s3 config object/)
    })

    it('refuses a driver it does not have, naming it', () => {
      expect(() => new TransferManager({ driver: 'gcs', path: '/files' } as any)).toThrow(/Unsupported driver gcs/)
    })

    it('builds an S3 store with and without an explicit port', () => {
      // The endpoint is composed from protocol, host and port. Both shapes have to produce a
      // client: a deployment against AWS names no port, one against MinIO always does.
      expect(() => new TransferManager({ driver: 's3', path: '/files', s3: S3 })).not.toThrow()
      expect(
        () => new TransferManager({ driver: 's3', path: '/files', s3: { ...S3, port: undefined, useSSL: true } })
      ).not.toThrow()
    })
  })

  describe('the gate in front of tus', () => {
    const request = () => ({ headers: {}, url: '/files' }) as any
    // tus 2 calls the hook with the request and the upload id, as TransferValidator declares.
    const ID = 'no-such-upload'

    it('runs the validator on every incoming request', async () => {
      const manager = local()
      const seen: any[] = []
      manager.setValidator(async (req, id) => {
        seen.push([req, id])
      })
      const server: any = manager.getServer()
      const req = request()
      await server.options.onIncomingRequest(req, ID)
      expect(seen).toEqual([[req, ID]])
    })

    it('lets the validator refusal through, because that refusal is the authorization', async () => {
      // A validator that throws must stop the request. Swallowed here, an upload endpoint would
      // accept bytes from anyone who knows the URL.
      const manager = local()
      manager.setValidator(async () => {
        throw new Error('NOT_ALLOWED')
      })
      const server: any = manager.getServer()
      await expect(server.options.onIncomingRequest(request(), ID)).rejects.toThrow('NOT_ALLOWED')
    })

    it('is a no-op when no validator was set', async () => {
      const server: any = local().getServer()
      await expect(server.options.onIncomingRequest(request(), ID)).resolves.toBeUndefined()
    })
  })

  describe('the owner of an upload', () => {
    // Over HTTP, as the backend serves it: the owner is what the server passes to `handle`, here
    // read from a header the test sets, never what the client writes in the upload's metadata.
    let manager: TransferManager
    let http: HttpServer
    let base: string

    before(async () => {
      manager = local()
      http = createServer((req, res) => {
        void manager.handle(req, res, req.headers['x-owner'] as string | undefined)
      })
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
      base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
    })
    after(async () => {
      await new Promise((resolve) => http.close(resolve))
    })

    const as = (owner?: string, headers: Record<string, string> = {}) => ({
      'Tus-Resumable': '1.0.0',
      ...(owner ? { 'x-owner': owner } : {}),
      ...headers
    })
    const metadata = (fields: Record<string, string>) =>
      Object.entries(fields)
        .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
        .join(',')
    const create = async (owner?: string, fields: Record<string, string> = {}) => {
      const response = await fetch(`${base}/files`, {
        method: 'POST',
        headers: as(owner, {
          'Upload-Length': '5',
          ...(Object.keys(fields).length ? { 'Upload-Metadata': metadata(fields) } : {})
        })
      })
      expect(response.status).toBe(201)
      return response.headers.get('location')!
    }
    const head = (url: string, owner?: string) => fetch(url, { method: 'HEAD', headers: as(owner) })
    const patch = (url: string, owner?: string) =>
      fetch(url, {
        method: 'PATCH',
        headers: as(owner, { 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' }),
        body: 'hello'
      })
    const stored = async (url: string) =>
      (await manager.getServer().datastore.getUpload(url.split('/').pop()!)).metadata

    it('answers 404 to anyone but the owner that created it, as if it did not exist', async () => {
      const url = await create('tenant-a/token:1')
      expect((await head(url, 'tenant-b/token:1')).status).toBe(404)
      expect((await head(url)).status).toBe(404)
      expect((await patch(url, 'tenant-a/token:2')).status).toBe(404)
      expect((await fetch(url, { method: 'DELETE', headers: as('tenant-a/token:2') })).status).toBe(404)
      // Nothing the others sent reached it.
      const own = await head(url, 'tenant-a/token:1')
      expect([own.status, own.headers.get('upload-offset')]).toEqual([200, '0'])
      expect((await patch(url, 'tenant-a/token:1')).status).toBe(204)
      expect((await fetch(url, { headers: as('tenant-a/token:2') })).status).toBe(404)
    })

    it('writes the owner itself: the one a client puts in the metadata is dropped', async () => {
      expect(await stored(await create('token:1', { owner: 'token:2', name: 'a.pdf' }))).toEqual({
        owner: 'token:1',
        name: 'a.pdf'
      })
      expect(await stored(await create(undefined, { owner: 'token:2', name: 'b.pdf' }))).toEqual({ name: 'b.pdf' })
    })

    it('leaves an upload created with no owner to whoever holds its id', async () => {
      const url = await create()
      expect((await patch(url, 'token:1')).status).toBe(204)
    })

    it("removes on request every upload of the owners named, finished or not, and leaves the others'", async () => {
      const [half, whole] = [await create('gone/token:1'), await create('gone/token:2')]
      expect((await patch(whole, 'gone/token:2')).status).toBe(204)
      const [other, nobody] = [await create('kept/token:1'), await create()]
      expect(await manager.removeOwned((owner) => owner.startsWith('gone/'))).toBe(2)
      const ids = [half, whole].map((url) => url.split('/').pop()!)
      expect(readdirSync(directory).filter((name) => ids.some((id) => name.startsWith(id)))).toEqual([])
      expect([(await head(half, 'gone/token:1')).status, (await head(whole, 'gone/token:2')).status]).toEqual([404, 404])
      expect([(await head(other, 'kept/token:1')).status, (await head(nobody)).status]).toEqual([200, 200])
    })

    it('hands the validator the web Request tus built, and the id of the upload', async () => {
      const seen: [string | null, string][] = []
      manager.setValidator(async (req, id) => {
        seen.push([req.headers.get('upload-length'), id])
      })
      try {
        const url = await create('token:1')
        expect(seen).toEqual([['5', url.split('/').pop()]])
      } finally {
        manager.setValidator(async () => {})
      }
    })
  })

  describe('the expiry of uploads', () => {
    /** A store of its own: the uploads written before any sweep starts, so none is caught half written. */
    const prepared = async () => {
      const own = mkdtempSync(join(tmpdir(), 'volcanic-transfer-expiry-'))
      const ready = new TransferManager({
        driver: 'local',
        path: '/files',
        local: { directory: own },
        expireAfterMs: 0
      }).getServer().datastore
      const upload = (id: string) => new Upload({ id, size: 5, offset: 0, creation_date: new Date().toISOString() })
      await ready.create(upload('unfinished'))
      await ready.create(upload('finished'))
      await ready.write(Readable.from([Buffer.from('hello')]), 'finished', 0)
      return own
    }
    const until = async (done: () => Promise<boolean>) => {
      const deadline = Date.now() + 2000
      while (!(await done()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
      return done()
    }

    it('sweeps on its own the unfinished uploads past their time, and keeps the finished ones', async () => {
      const own = await prepared()
      const manager = new TransferManager({
        driver: 'local',
        path: '/files',
        local: { directory: own },
        expireAfterMs: 50
      })
      const store = manager.getServer().datastore
      try {
        expect(
          await until(() =>
            store.getUpload('unfinished').then(
              () => false,
              () => true
            )
          )
        ).toBe(true)
        expect((await store.getUpload('finished')).offset).toBe(5)
      } finally {
        manager.close()
        rmSync(own, { recursive: true, force: true })
      }
    })

    it('sweeps the finished uploads idle past expireFinishedAfterMs, apart from the unfinished ones', async () => {
      const own = await prepared()
      const manager = new TransferManager({
        driver: 'local',
        path: '/files',
        local: { directory: own },
        expireAfterMs: 0,
        expireFinishedAfterMs: 50
      })
      const store = manager.getServer().datastore
      try {
        expect(
          await until(() =>
            store.getUpload('finished').then(
              () => false,
              () => true
            )
          )
        ).toBe(true)
        expect((await store.getUpload('unfinished')).offset).toBe(0)
      } finally {
        manager.close()
        rmSync(own, { recursive: true, force: true })
      }
    })

    it('on S3, deletes a finished upload past its time with its .info, and nothing that tus did not write', async () => {
      // A bucket in memory, listed a page at a time as S3 does; the unfinished uploads are S3's own
      // sweep's, off here with `expireAfterMs: 0`.
      const old = new Date(Date.now() - 60_000)
      const bucket = new Map<string, Date>([
        ['old', old],
        ['old.info', old],
        ['young', new Date()],
        ['young.info', new Date()],
        ['open.info', old],
        ['open.part', old],
        ['report.pdf', old]
      ])
      const deleted: string[] = []
      const manager = new TransferManager({
        driver: 's3',
        path: '/files',
        s3: S3,
        expireAfterMs: 0,
        expireFinishedAfterMs: 30_000
      })
      const store: any = manager.getServer().datastore
      store.client = {
        async listObjectsV2({ ContinuationToken }: { ContinuationToken?: string }) {
          const keys = [...bucket.keys()]
          const from = Number(ContinuationToken ?? 0)
          const page = keys.slice(from, from + 3)
          const next = from + 3 < keys.length ? String(from + 3) : undefined
          return {
            Contents: page.map((Key) => ({ Key, LastModified: bucket.get(Key) })),
            IsTruncated: next !== undefined,
            NextContinuationToken: next
          }
        },
        async deleteObjects({ Delete }: { Delete: { Objects: { Key: string }[] } }) {
          deleted.push(...Delete.Objects.map((object) => object.Key))
          return {}
        }
      }
      try {
        expect(await manager.cleanUpExpired()).toBe(1)
        expect(deleted).toEqual(['old', 'old.info'])
      } finally {
        manager.close()
      }
    })

    it("on S3, removes on request every upload of the owners named, its multipart upload aborted, and leaves the others'", async () => {
      // A bucket in memory: each upload's `.info`, as tus writes it, and the multipart upload it opened.
      const info: Record<string, { owner?: string; open: string }> = {
        finished: { owner: 'gone/token:1', open: 'mp-1' },
        unfinished: { owner: 'gone/token:2', open: 'mp-2' },
        other: { owner: 'kept/token:1', open: 'mp-3' },
        nobody: { open: 'mp-4' }
      }
      const keys = [...Object.keys(info).flatMap((id) => [id, `${id}.info`]), 'unfinished.part', 'report.pdf']
      const [deleted, aborted]: string[][] = [[], []]
      const manager = new TransferManager({ driver: 's3', path: '/files', s3: S3, expireAfterMs: 0 })
      const store: any = manager.getServer().datastore
      store.client = {
        async listObjectsV2() {
          return { Contents: keys.map((Key) => ({ Key, LastModified: new Date() })), IsTruncated: false }
        },
        async getObject({ Key }: { Key: string }) {
          const { owner, open } = info[Key.replace(/\.info$/, '')]
          const upload = { size: 5, offset: 0, metadata: owner ? { owner } : {}, creation_date: new Date().toISOString() }
          return { Metadata: { 'upload-id': open }, Body: { transformToString: async () => JSON.stringify(upload) } }
        },
        async abortMultipartUpload({ Key, UploadId }: { Key: string; UploadId: string }) {
          // S3's answer for the one it completed when the last byte arrived.
          if (Key === 'finished') throw Object.assign(new Error('The specified upload does not exist'), { name: 'NoSuchUpload' })
          aborted.push(UploadId)
          return {}
        },
        async deleteObjects({ Delete }: { Delete: { Objects: { Key: string }[] } }) {
          deleted.push(...Delete.Objects.map((object) => object.Key))
          return {}
        }
      }
      try {
        expect(await manager.removeOwned((owner) => owner.startsWith('gone/'))).toBe(2)
        expect(aborted).toEqual(['mp-2'])
        expect(deleted.sort()).toEqual(
          ['finished', 'finished.info', 'finished.part', 'unfinished', 'unfinished.info', 'unfinished.part'].sort()
        )
      } finally {
        manager.close()
      }
    })

    it('expires the unfinished after 24 hours and keeps the finished unless told otherwise, and 0 keeps them', () => {
      const store = (over: any = {}) => local(over).getServer().datastore as any
      expect([store().getExpiration(), store().finishedExpiration]).toEqual([24 * 60 * 60 * 1000, 0])
      expect(store({ expireAfterMs: 0, expireFinishedAfterMs: 60_000 })).toMatchObject({
        expirationPeriodInMilliseconds: 0,
        finishedExpiration: 60_000
      })
    })

    it('refuses an expiry that is not a whole number of milliseconds, 0 or more', () => {
      for (const name of ['expireAfterMs', 'expireFinishedAfterMs']) {
        for (const value of [-1, 1.5, Number.NaN, '60000']) {
          expect(() => local({ [name]: value })).toThrow(new RegExp(`${name} must be a whole number`))
        }
      }
    })
  })

  describe('on a real S3', function () {
    // Only with `TRANSFER_S3_URL`, e.g. http://user:password@127.0.0.1:9000 of a MinIO: the stores'
    // calls to S3 are what a fake client cannot vouch for. Each run takes a bucket of its own.
    const target = process.env.TRANSFER_S3_URL ? new URL(process.env.TRANSFER_S3_URL) : undefined
    const bucket = `transfer-test-${Date.now()}`
    let client: S3Client
    let manager: TransferManager
    let http: HttpServer
    let base: string

    before(async function () {
      if (!target) return this.skip()
      const credentials = {
        accessKeyId: decodeURIComponent(target.username),
        secretAccessKey: decodeURIComponent(target.password)
      }
      client = new S3Client({ endpoint: target.origin, region: 'us-east-1', forcePathStyle: true, credentials })
      await client.createBucket({ Bucket: bucket })
      manager = new TransferManager({
        driver: 's3',
        path: '/files',
        s3: {
          bucket,
          endPoint: target.hostname,
          port: Number(target.port),
          useSSL: target.protocol === 'https:',
          ...{ accessKey: credentials.accessKeyId, secretKey: credentials.secretAccessKey }
        },
        expireAfterMs: 1000,
        expireFinishedAfterMs: 1000
      })
      // Swept by hand below, when the test says.
      manager.close()
      // The owner from a header the test sets, as in the owner tests above.
      http = createServer((req, res) => void manager.handle(req, res, req.headers['x-owner'] as string | undefined))
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
      base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
    })
    after(async () => {
      if (!target) return
      await new Promise((resolve) => http.close(resolve))
      const left = (await client.listObjectsV2({ Bucket: bucket })).Contents ?? []
      if (left.length)
        await client.deleteObjects({ Bucket: bucket, Delete: { Objects: left.map(({ Key }) => ({ Key })) } })
      for (const open of (await client.listMultipartUploads({ Bucket: bucket })).Uploads ?? []) {
        await client.abortMultipartUpload({ Bucket: bucket, Key: open.Key, UploadId: open.UploadId })
      }
      await client.deleteBucket({ Bucket: bucket })
    })

    const tus = { 'Tus-Resumable': '1.0.0' }
    /** An upload of `size` bytes with `sent` of them written: its id. */
    const upload = async (size: number, sent: string) => {
      const created = await fetch(`${base}/files`, {
        method: 'POST',
        headers: { ...tus, 'Upload-Length': String(size) }
      })
      expect(created.status).toBe(201)
      const url = created.headers.get('location')!
      const patched = await fetch(url, {
        method: 'PATCH',
        headers: { ...tus, 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
        body: sent
      })
      expect(patched.status).toBe(204)
      return url.split('/').pop()!
    }
    const keys = async () =>
      ((await client.listObjectsV2({ Bucket: bucket })).Contents ?? []).map(({ Key }) => Key!).sort()

    it('removes a finished upload, whose multipart upload S3 has long completed', async () => {
      const id = await upload(5, 'hello')
      expect(await keys()).toEqual([id, `${id}.info`].sort())
      expect((await fetch(`${base}/files/${id}`, { method: 'DELETE', headers: tus })).status).toBe(204)
      expect(await keys()).toEqual([])
    })

    it('sweeps the finished and the unfinished uploads past their time, and nothing tus did not write', async () => {
      await client.putObject({ Bucket: bucket, Key: 'report.pdf', Body: 'not an upload' })
      const finished = await upload(5, 'hello')
      const unfinished = await upload(10, 'hello')
      expect(await keys()).toEqual(
        [finished, `${finished}.info`, `${unfinished}.info`, `${unfinished}.part`, 'report.pdf'].sort()
      )
      await new Promise((resolve) => setTimeout(resolve, 1100))
      expect(await manager.cleanUpExpired()).toBe(2)
      expect(await keys()).toEqual(['report.pdf'])
      expect((await client.listMultipartUploads({ Bucket: bucket })).Uploads ?? []).toEqual([])
    })

    it("removes on request the finished and unfinished uploads of the owners named, and leaves the others'", async () => {
      const owned = (owner: string) => async () => {
        const created = await fetch(`${base}/files`, { method: 'POST', headers: { ...tus, 'Upload-Length': '10', 'x-owner': owner } })
        return created.headers.get('location')!.split('/').pop()!
      }
      const send = (id: string, owner: string, body: string, offset = 0) =>
        fetch(`${base}/files/${id}`, {
          method: 'PATCH',
          headers: { ...tus, 'x-owner': owner, 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
          body
        })
      const [finished, unfinished, other] = [await owned('gone/token:1')(), await owned('gone/token:2')(), await owned('kept/token:1')()]
      expect((await send(finished, 'gone/token:1', 'helloworld')).status).toBe(204)
      expect((await send(unfinished, 'gone/token:2', 'hello')).status).toBe(204)
      expect(await manager.removeOwned((owner) => owner.startsWith('gone/'))).toBe(2)
      // `report.pdf`, which the test above put and tus did not write, stays too.
      expect(await keys()).toEqual([`${other}.info`, 'report.pdf'].sort())
      const open = ((await client.listMultipartUploads({ Bucket: bucket })).Uploads ?? []).map(({ Key }) => Key)
      expect(open).toEqual([other])
      await manager.removeOwned(() => true)
    })
  })

  describe('the contract with @volcanicminds/backend', () => {
    // `TransferManagement` in the backend's types/global.d.ts. The two packages do not depend on
    // each other; volcanic-backend-sample type-checks the assignment where both are installed.
    const CONTRACT = [
      'isImplemented',
      'getPath',
      'getServer',
      'onUploadCreate',
      'onUploadFinish',
      'onUploadTerminate',
      'handle',
      'isValid',
      'removeOwned'
    ]
    const anonymous = { headers: {}, method: 'POST', url: '/files' }

    it('has every method the backend calls', () => {
      const manager: any = local()
      for (const name of CONTRACT) expect(typeof manager[name]).toBe('function')
    })

    it('answers getPath with the configured path', () => {
      expect(local({ path: '/uploads' }).getPath()).toBe('/uploads')
    })

    it('vouches for no anonymous request until the application says how', async () => {
      await expect(local().isValid(anonymous)).resolves.toBe(false)
    })

    it('asks the anonymous-access check, with the request', async () => {
      const manager = local()
      const seen: any[] = []
      manager.setAnonymousAccess(async (req) => {
        seen.push(req)
        return req.headers['x-upload-signature'] === 'signed'
      })
      await expect(manager.isValid(anonymous)).resolves.toBe(false)
      await expect(manager.isValid({ ...anonymous, headers: { 'x-upload-signature': 'signed' } })).resolves.toBe(true)
      expect(seen).toHaveLength(2)
    })

    it('reads only a literal true as a yes', async () => {
      const manager = local()
      manager.setAnonymousAccess((() => 'yes') as any)
      await expect(manager.isValid(anonymous)).resolves.toBe(false)
    })

    it('lets a failing check throw, so the request is not served', async () => {
      const manager = local()
      manager.setAnonymousAccess(() => {
        throw new Error('signature store unreachable')
      })
      await expect(manager.isValid(anonymous)).rejects.toThrow('signature store unreachable')
    })
  })

  describe('the hooks a consumer registers', () => {
    const req = { url: '/files' } as any
    const res = { statusCode: 200 } as any
    const upload = { id: 'abc', size: 10 } as any

    it('hands an upload and its request to the finish hook', () => {
      const manager = local()
      const seen: any[] = []
      manager.onUploadFinish((u, r, s) => seen.push([u, r, s]))
      // tus emits POST_FINISH as (req, res, upload).
      ;(manager.getServer() as any).emit(EVENTS.POST_FINISH, req, res, upload)
      expect(seen).toEqual([[upload, req, res]])
    })

    it('hands the id to the terminate hook, which is all tus reports', () => {
      const manager = local()
      const seen: any[] = []
      manager.onUploadTerminate((id, r, s) => seen.push([id, r, s]))
      // tus emits POST_TERMINATE as (req, res, id).
      ;(manager.getServer() as any).emit(EVENTS.POST_TERMINATE, req, res, 'abc')
      expect(seen).toEqual([['abc', req, res]])
    })

    it('hands the upload to the create hook', () => {
      // tus 2.x emits POST_CREATE as (req, upload, url): three arguments, and the second is the
      // upload, not the response. A consumer that records an upload from this hook is recording
      // whatever the second argument is, so the order is the whole contract.
      const manager = local()
      const seen: any[] = []
      manager.onUploadCreate((u, r) => seen.push([u, r]))
      ;(manager.getServer() as any).emit(EVENTS.POST_CREATE, req, upload, 'https://host/files/abc')
      expect(seen).toEqual([[upload, req]])
    })

    it('hands every hook the web Request tus built, and finish and terminate the web Response', async () => {
      const manager = local()
      const seen: unknown[][] = []
      manager.onUploadCreate((u, r, s) => seen.push(['create', u.size, r.headers.get('upload-length'), s?.status]))
      manager.onUploadFinish((u, r, s) => seen.push(['finish', u.offset, r.headers.get('upload-offset'), s?.status]))
      manager.onUploadTerminate((id, r, s) => seen.push(['terminate', typeof id, r.method, s?.status]))
      const http = createServer((req, res) => void manager.handle(req, res))
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
      try {
        const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
        const tus = { 'Tus-Resumable': '1.0.0' }
        const url = (
          await fetch(`${base}/files`, { method: 'POST', headers: { ...tus, 'Upload-Length': '5' } })
        ).headers.get('location')!
        await fetch(url, {
          method: 'PATCH',
          headers: { ...tus, 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
          body: 'hello'
        })
        await fetch(url, { method: 'DELETE', headers: tus })
        expect(seen).toEqual([
          ['create', 5, '5', undefined],
          ['finish', 5, '0', 204],
          ['terminate', 'string', 'DELETE', 204]
        ])
      } finally {
        await new Promise((resolve) => http.close(resolve))
        manager.close()
      }
    })
  })
})
