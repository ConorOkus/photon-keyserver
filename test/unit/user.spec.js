/* eslint-env mocha */

'use strict'

const sinon = require('sinon')
const expect = require('unexpected')
const verify = require('../../src/lib/verify')
const dynamo = require('../../src/service/dynamodb')
const userDao = require('../../src/dao/user')

describe('User DAO unit test', () => {
  let sandbox
  const phone = '+4917512345678'
  const keyId = '8abe1a93-6a9c-490c-bbd5-d7f11a4a9c8f'
  const op = 'read'
  const code1 = '123456'
  const code2 = '654321'

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    sandbox.stub(dynamo)
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('create', () => {
    it('fail on invalid args', async () => {
      await expect(userDao.create({}), 'to be rejected with', /Invalid/)
    })

    it('fail on dynamo error', async () => {
      dynamo.put.rejects(new Error('boom'))
      await expect(userDao.create({ phone, keyId }), 'to be rejected with', /boom/)
    })

    it('store a new user', async () => {
      const code = await userDao.create({ phone, keyId })
      expect(code, 'to match', /^\d{6}$/)
      expect(dynamo.put.callCount, 'to equal', 1)
    })
  })

  describe('verify', () => {
    it('fail on invalid args', async () => {
      await expect(userDao.verify({}), 'to be rejected with', /Invalid/)
    })

    it('return null if no user is found', async () => {
      dynamo.get.resolves(null)
      const { user, delay } = await userDao.verify({ phone, keyId, op, code: code1 })
      expect(user, 'to be', null)
      expect(delay, 'to be', undefined)
      expect(dynamo.put.callCount, 'to equal', 0)
    })

    it('not verify a user with incorrect code (no rate limit)', async () => {
      dynamo.get.resolves({
        keyId,
        op,
        code: code2,
        verified: false,
        invalidCount: 9
      })
      const { user, delay } = await userDao.verify({ phone, keyId, op, code: code1 })
      expect(user, 'to be', null)
      expect(delay, 'to be', null)
      expect(dynamo.put.callCount, 'to equal', 1)
      expect(dynamo.put.calledWithMatch(sinon.match.any, {
        invalidCount: 10,
        firstInvalid: sinon.match.string
      }), 'to be ok')
    })

    it('rate limit brute forcing of incorrect code', async () => {
      dynamo.get.resolves({
        keyId,
        op,
        code: code2,
        verified: false,
        invalidCount: 10
      })
      const { user, delay } = await userDao.verify({ phone, keyId, op, code: code1 })
      expect(user, 'to be', null)
      expect(verify.isDateISOString(delay), 'to be', true)
      expect(dynamo.put.callCount, 'to equal', 1)
      expect(dynamo.put.calledWithMatch(sinon.match.any, {
        invalidCount: 11,
        firstInvalid: sinon.match.string
      }), 'to be ok')
    })

    it('rate limit brute forcing of correct code', async () => {
      dynamo.get.resolves({
        keyId,
        op,
        code: code1,
        verified: false,
        invalidCount: 10
      })
      const { user, delay } = await userDao.verify({ phone, keyId, op, code: code1 })
      expect(user, 'to be', null)
      expect(verify.isDateISOString(delay), 'to be', true)
      expect(dynamo.put.callCount, 'to equal', 1)
      expect(dynamo.put.calledWithMatch(sinon.match.any, {
        invalidCount: 11,
        firstInvalid: sinon.match.string
      }), 'to be ok')
    })

    it('reset rate limit after time delay is over', async () => {
      dynamo.get.resolves({
        keyId,
        op,
        code: code2,
        verified: false,
        invalidCount: 10,
        firstInvalid: '2020-06-01T03:33:47.980Z'
      })
      const { user, delay } = await userDao.verify({ phone, keyId, op, code: code1 })
      expect(user, 'to be', null)
      expect(delay, 'to be', null)
      expect(dynamo.put.callCount, 'to equal', 1)
      expect(dynamo.put.calledWithMatch(sinon.match.any, {
        invalidCount: 0,
        firstInvalid: null
      }), 'to be ok')
    })

    it('not verify a user with incorrect keyId', async () => {
      dynamo.get.resolves({
        keyId: 'wrong-id',
        op,
        code: code1,
        verified: false
      })
      const { user, delay } = await userDao.verify({ phone, keyId, op, code: code1 })
      expect(user, 'to be', null)
      expect(delay, 'to be', undefined)
      expect(dynamo.put.callCount, 'to equal', 0)
    })

    it('not verify a user with incorrect op', async () => {
      dynamo.get.resolves({
        keyId,
        op: 'remove',
        code: code1,
        verified: false
      })
      const { user, delay } = await userDao.verify({ phone, keyId, op, code: code1 })
      expect(user, 'to be', null)
      expect(delay, 'to be', undefined)
      expect(dynamo.put.callCount, 'to equal', 0)
    })

    it('fail on dynamo get error', async () => {
      dynamo.get.rejects(new Error('boom'))
      await expect(userDao.verify({ phone, keyId, op, code: code1 }), 'to be rejected with', /boom/)
    })

    it('fail on dynamo put error', async () => {
      dynamo.get.resolves({
        keyId,
        op,
        code: code1,
        verified: false
      })
      dynamo.put.rejects(new Error('boom'))
      await expect(userDao.verify({ phone, keyId, op, code: code1 }), 'to be rejected with', /boom/)
    })

    it('verify a user with correct code', async () => {
      dynamo.get.resolves({
        keyId,
        op,
        code: code1,
        verified: false,
        invalidCount: 1
      })
      const { user, delay } = await userDao.verify({ phone, keyId, op, code: code1 })
      expect(user.verified, 'to be', true)
      expect(user.code, 'not to be', code1)
      expect(delay, 'to be', undefined)
      expect(dynamo.put.callCount, 'to equal', 2)
      expect(dynamo.put.calledWithMatch(sinon.match.any, {
        invalidCount: 0,
        firstInvalid: null
      }), 'to be ok')
    })
  })

  describe('get', () => {
    it('fail on invalid args', async () => {
      await expect(userDao.get({}), 'to be rejected with', /Invalid/)
    })

    it('return null if no user is found', async () => {
      dynamo.get.resolves(null)
      const user = await userDao.get({ phone })
      expect(user, 'to be', null)
    })

    it('fail on dynamo get error', async () => {
      dynamo.get.rejects(new Error('boom'))
      await expect(userDao.get({ phone }), 'to be rejected with', /boom/)
    })

    it('return a user', async () => {
      dynamo.get.resolves({})
      const user = await userDao.get({ phone })
      expect(user, 'to be ok')
    })
  })

  describe('getVerified', () => {
    it('fail on invalid args', async () => {
      await expect(userDao.getVerified({}), 'to be rejected with', /Invalid/)
    })

    it('return null if no user is found', async () => {
      dynamo.get.resolves(null)
      const user = await userDao.getVerified({ phone })
      expect(user, 'to be', null)
    })

    it('return null for unverified user', async () => {
      dynamo.get.resolves({ verified: false })
      const user = await userDao.getVerified({ phone })
      expect(user, 'to be', null)
    })

    it('fail on dynamo get error', async () => {
      dynamo.get.rejects(new Error('boom'))
      await expect(userDao.getVerified({ phone }), 'to be rejected with', /boom/)
    })

    it('return a verified user', async () => {
      dynamo.get.resolves({ verified: true })
      const user = await userDao.getVerified({ phone })
      expect(user.verified, 'to be ok')
    })
  })

  describe('setNewCode', () => {
    it('fail on invalid args', async () => {
      await expect(userDao.setNewCode({}), 'to be rejected with', /Invalid/)
    })

    it('fail if no user is found', async () => {
      dynamo.get.resolves(null)
      const code = await userDao.setNewCode({ phone, keyId, op })
      expect(code, 'to be', null)
      expect(dynamo.put.callCount, 'to equal', 0)
    })

    it('fail if user is not verified', async () => {
      dynamo.get.resolves({ keyId, verified: false })
      const code = await userDao.setNewCode({ phone, keyId, op })
      expect(code, 'to be', null)
      expect(dynamo.put.callCount, 'to equal', 0)
    })

    it('fail if user has wrong key id', async () => {
      dynamo.get.resolves({ keyId: 'wrong-id', verified: true })
      const code = await userDao.setNewCode({ phone, keyId, op })
      expect(code, 'to be', null)
      expect(dynamo.put.callCount, 'to equal', 0)
    })

    it('fail on dynamo get error', async () => {
      dynamo.get.rejects(new Error('boom'))
      await expect(userDao.setNewCode({ phone, keyId, op }), 'to be rejected with', /boom/)
    })

    it('fail on dynamo put error', async () => {
      dynamo.get.resolves({ keyId, verified: true })
      dynamo.put.rejects(new Error('boom'))
      await expect(userDao.setNewCode({ phone, keyId, op }), 'to be rejected with', /boom/)
    })

    it('set a new code and persist', async () => {
      dynamo.get.resolves({
        keyId,
        code: 'old',
        verified: true,
        invalidCount: 6,
        firstInvalid: '2020-06-01T03:33:47.980Z'
      })
      const code = await userDao.setNewCode({ phone, keyId, op })
      expect(code, 'to match', /^\d{6}$/)
      expect(dynamo.put.callCount, 'to equal', 1)
      expect(dynamo.put.calledWithMatch(sinon.match.any, {
        keyId,
        op,
        code,
        verified: true,
        firstInvalid: '2020-06-01T03:33:47.980Z',
        invalidCount: 6
      }), 'to be ok')
    })
  })

  describe('remove', () => {
    it('fail on invalid args', async () => {
      await expect(userDao.remove({}), 'to be rejected with', /Invalid/)
    })

    it('fail if no user is found', async () => {
      dynamo.get.resolves(null)
      await expect(userDao.remove({ phone, keyId }), 'to be rejected with', /matching/)
      expect(dynamo.remove.callCount, 'to equal', 0)
    })

    it('fail if user has wrong key id', async () => {
      dynamo.get.resolves({ keyId: 'wrong-id' })
      await expect(userDao.remove({ phone, keyId }), 'to be rejected with', /matching/)
      expect(dynamo.remove.callCount, 'to equal', 0)
    })

    it('fail on dynamo get error', async () => {
      dynamo.get.rejects(new Error('boom'))
      await expect(userDao.remove({ phone, keyId }), 'to be rejected with', /boom/)
      expect(dynamo.remove.callCount, 'to equal', 0)
    })

    it('remove user from table', async () => {
      dynamo.get.resolves({ keyId })
      await userDao.remove({ phone, keyId })
      expect(dynamo.remove.callCount, 'to equal', 1)
    })
  })
})
