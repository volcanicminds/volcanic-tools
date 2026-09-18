/* eslint-disable @typescript-eslint/no-explicit-any */
//
// TransferManager: the resumable upload endpoint (tus), wrapped.
//
// The wrapper owns four things, and each of them is a place where a mistake is silent rather
// than loud: which store a driver builds, what happens to a request before tus sees it (the
// authorization gate), the arguments a consumer's hook receives, and the refusals when the
// configuration cannot produce a store at all. None of it needs a network: the local driver
// writes into a temporary directory, and the S3 store builds its client without talking to
// anything.
//
import { expect } from 'expect'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EVENTS } from '@tus/server'
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
    const response = () => ({}) as any

    it('runs the validator on every incoming request', async () => {
      const manager = local()
      const seen: any[] = []
      manager.setValidator(async (req, res) => {
        seen.push([req, res])
      })
      const server: any = manager.getServer()
      const req = request()
      const res = response()
      await server.options.onIncomingRequest(req, res)
      expect(seen).toEqual([[req, res]])
    })

    it('lets the validator refusal through, because that refusal is the authorization', async () => {
      // A validator that throws must stop the request. Swallowed here, an upload endpoint would
      // accept bytes from anyone who knows the URL.
      const manager = local()
      manager.setValidator(async () => {
        throw new Error('NOT_ALLOWED')
      })
      const server: any = manager.getServer()
      await expect(server.options.onIncomingRequest(request(), response())).rejects.toThrow('NOT_ALLOWED')
    })

    it('is a no-op when no validator was set', async () => {
      const server: any = local().getServer()
      await expect(server.options.onIncomingRequest(request(), response())).resolves.toBeUndefined()
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
