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
import { mkdtempSync, rmSync } from 'fs'
import { createServer, type Server as HttpServer } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
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

  describe('the contract with @volcanicminds/backend', () => {
    // `TransferManagement` in the backend's types/global.d.ts. The two packages do not depend on
    // each other; volcanic-backend-sample type-checks the assignment where both are installed.
    const CONTRACT = ['isImplemented', 'getPath', 'getServer', 'onUploadCreate', 'onUploadFinish', 'onUploadTerminate', 'handle', 'isValid']
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
  })
})
