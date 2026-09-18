/* eslint-disable @typescript-eslint/no-explicit-any */
//
// StorageManager, exercised against a recording double of the MinIO client.
//
// Everything this class owns is the part between a caller and the SDK: the name check, the
// bucket that has to exist before a write, the expiry of a signed URL, and what an error means.
// The SDK itself is not under test, so the client is swapped for a double that records what it
// was asked to do — the same shape as `mailer.spec.ts`, which puts nodemailer's own transport in
// place of an SMTP server.
//
import { expect } from 'expect'
import { Readable } from 'stream'
import { StorageManager } from '../../lib/storage/index.js'

const CONFIG = {
  endPoint: 'minio.test',
  port: 9000,
  useSSL: false,
  accessKey: 'key',
  secretKey: 'secret',
  bucket: 'media',
  region: 'eu-south-1'
}

type Call = { name: string; args: any[] }

function storage(overrides: Record<string, any> = {}, config: any = CONFIG) {
  const calls: Call[] = []
  const stub =
    (name: string, fallback: any) =>
    async (...args: any[]) => {
      calls.push({ name, args })
      const over = overrides[name]
      if (typeof over === 'function') return over(...args)
      return over !== undefined ? over : fallback
    }

  const client: any = {
    listBuckets: stub('listBuckets', []),
    bucketExists: stub('bucketExists', true),
    makeBucket: stub('makeBucket', undefined),
    putObject: stub('putObject', { etag: 'etag-1', versionId: null }),
    presignedGetObject: stub('presignedGetObject', 'https://signed/get'),
    presignedPutObject: stub('presignedPutObject', 'https://signed/put'),
    removeObject: stub('removeObject', undefined),
    removeObjects: stub('removeObjects', undefined),
    statObject: stub('statObject', { size: 10 }),
    getObject: stub('getObject', Readable.from(['x']))
  }

  const manager = new StorageManager(config)
  ;(manager as any).client = client
  const called = (name: string) => calls.filter((c) => c.name === name)
  return { manager, calls, called }
}

// An object name is the only part of a request a caller controls. Every one of these either
// leaves the bucket or names something the caller did not mean.
const REFUSED = ['', '   ', '../secrets', 'nested/../../secrets', '/absolute', './relative', 'windows\\path']

describe('StorageManager', () => {
  describe('object names', () => {
    it('refuses a name that climbs out of the bucket, before the client is touched', async () => {
      for (const name of REFUSED) {
        const { manager, calls } = storage()
        await expect(manager.getFileUrl(name)).rejects.toThrow()
        // The point is not only the refusal: nothing must have been asked of the storage. A
        // check that runs after the call has already left is not a check.
        expect(calls).toEqual([])
      }
    })

    it('applies the same check to every method that names an object', async () => {
      const { manager, calls } = storage()
      const bad = 'nested/../../secrets'
      await expect(manager.uploadFile(bad, Buffer.from('x'))).rejects.toThrow(/Invalid object name/)
      await expect(manager.getUploadUrl(bad)).rejects.toThrow(/Invalid object name/)
      await expect(manager.deleteFile(bad)).rejects.toThrow(/Invalid object name/)
      await expect(manager.fileExists(bad)).rejects.toThrow(/Invalid object name/)
      await expect(manager.getFileStream(bad)).rejects.toThrow(/Invalid object name/)
      await expect(manager.getFileStat(bad)).rejects.toThrow(/Invalid object name/)
      expect(calls).toEqual([])
    })

    it('names an empty object name for what it is, instead of refusing it as a traversal', async () => {
      const { manager } = storage()
      await expect(manager.deleteFile('   ')).rejects.toThrow(/cannot be empty/)
    })

    it('validates every name of a bulk delete, not just the first', async () => {
      // One bad name and nothing is removed: a partial bulk delete is the worst of both, because
      // the caller cannot tell what survived.
      const { manager, called } = storage()
      await expect(manager.deleteFiles(['fine.txt', '../secrets'])).rejects.toThrow(/Invalid object name/)
      expect(called('removeObjects')).toEqual([])
    })
  })

  describe('writing', () => {
    it('makes sure the bucket exists before the first upload, and only when it is missing', async () => {
      const present = storage({ bucketExists: true })
      await present.manager.uploadFile('a.txt', Buffer.from('x'))
      expect(present.called('makeBucket')).toEqual([])

      const absent = storage({ bucketExists: false })
      await absent.manager.uploadFile('a.txt', Buffer.from('x'))
      expect(absent.called('makeBucket')[0].args).toEqual(['media', 'eu-south-1'])
    })

    it('passes size and metadata through, and sends an empty metadata by default', async () => {
      const { manager, called } = storage()
      const body = Buffer.from('hello')
      const result = await manager.uploadFile('a.txt', body, { size: 5, metadata: { 'x-owner': 'u1' } })
      expect(result).toEqual({ etag: 'etag-1', versionId: null })
      expect(called('putObject')[0].args).toEqual(['media', 'a.txt', body, 5, { 'x-owner': 'u1' }])

      const bare = storage()
      await bare.manager.uploadFile('b.txt', body)
      // `undefined` size, not 0: MinIO reads the length from the stream, and a declared 0 would
      // store an empty object.
      expect(bare.called('putObject')[0].args).toEqual(['media', 'b.txt', body, undefined, {}])
    })

    it('says which bucket failed when the bucket cannot be ensured', async () => {
      const { manager } = storage({
        bucketExists: () => {
          throw new Error('connection refused')
        }
      })
      await expect(manager.ensureBucket()).rejects.toThrow(/Failed to ensure bucket media/)
    })

    it('ensures the bucket it was asked for, in the configured region', async () => {
      const { manager, called } = storage({ bucketExists: false })
      await manager.ensureBucket('exports')
      expect(called('bucketExists')[0].args).toEqual(['exports'])
      expect(called('makeBucket')[0].args).toEqual(['exports', 'eu-south-1'])
    })

    it('falls back to us-east-1 when no region is configured', async () => {
      const { manager, called } = storage({ bucketExists: false }, { ...CONFIG, region: undefined })
      await manager.ensureBucket()
      expect(called('makeBucket')[0].args).toEqual(['media', 'us-east-1'])
    })
  })

  describe('reading', () => {
    it('signs a download for a day by default, and honours an explicit expiry', async () => {
      const { manager, called } = storage()
      expect(await manager.getFileUrl('a.txt')).toBe('https://signed/get')
      expect(called('presignedGetObject')[0].args).toEqual(['media', 'a.txt', 86400])

      await manager.getFileUrl('a.txt', 60)
      expect(called('presignedGetObject')[1].args).toEqual(['media', 'a.txt', 60])
    })

    it('signs an upload the same way', async () => {
      const { manager, called } = storage()
      expect(await manager.getUploadUrl('a.txt')).toBe('https://signed/put')
      expect(called('presignedPutObject')[0].args).toEqual(['media', 'a.txt', 86400])
    })

    it('answers false for a missing object', async () => {
      const { manager } = storage({
        statObject: () => Promise.reject(Object.assign(new Error('Not found'), { code: 'NotFound' }))
      })
      expect(await manager.fileExists('gone.txt')).toBe(false)
    })

    it('raises anything that is not a missing object, instead of reading it as absence', async () => {
      // A permission error answered as `false` is how a caller decides the file is not there and
      // writes over something it cannot see.
      const { manager } = storage({
        statObject: () => Promise.reject(Object.assign(new Error('Access denied'), { code: 'AccessDenied' }))
      })
      await expect(manager.fileExists('locked.txt')).rejects.toThrow(/Access denied/)
    })
  })

  describe('the connection', () => {
    it('confirms a storage it can list', async () => {
      const { manager, called } = storage()
      expect(await manager.verifyConnection()).toBe(true)
      expect(called('listBuckets').length).toBe(1)
    })

    it('answers false instead of raising when the storage is unreachable', async () => {
      const { manager } = storage({ listBuckets: () => Promise.reject(new Error('ECONNREFUSED')) })
      const wasError = console.error
      console.error = () => {}
      try {
        expect(await manager.verifyConnection()).toBe(false)
      } finally {
        console.error = wasError
      }
    })

    it('hands back the bucket it was configured with', () => {
      const { manager, client } = { ...storage(), client: undefined }
      void client
      expect(manager.getBucketName()).toBe('media')
      expect(manager.getClient()).toBeDefined()
    })
  })
})
