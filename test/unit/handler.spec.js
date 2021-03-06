/* eslint-env mocha */

'use strict'

const sinon = require('sinon')
const expect = require('unexpected')
const keyDao = require('../../src/dao/key')
const userDao = require('../../src/dao/user')
const twilio = require('../../src/service/twilio')
const dynamo = require('../../src/service/dynamodb')

describe('Api Handler unit test', () => {
  let sandbox
  let handler
  const phone = '+4917512345678'
  const keyId = '8abe1a93-6a9c-490c-bbd5-d7f11a4a9c8f'
  const code = '123456'
  const op = 'read'

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    sandbox.stub(dynamo)
    sandbox.stub(twilio)
    sandbox.stub(keyDao)
    sandbox.stub(userDao)
    sandbox.stub(console, 'error')
    handler = require('../../handler')
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('createKey', () => {
    it('handle empty body', async () => {
      const response = await handler.createKey({})
      expect(response.statusCode, 'to be', 400)
    })

    it('existing user should look like success for privacy', async () => {
      userDao.getVerified.resolves('some-user')
      keyDao.createDummy.returns('dummy-id')
      const response = await handler.createKey({ body: JSON.stringify({ phone }) })
      expect(response.statusCode, 'to be', 201)
      expect(JSON.parse(response.body).id, 'to be', 'dummy-id')
      expect(keyDao.create.callCount, 'to be', 0)
      expect(twilio.send.callCount, 'to be', 0)
    })

    it('successfully create a new user', async () => {
      keyDao.create.resolves('some-id')
      const response = await handler.createKey({ body: JSON.stringify({ phone }) })
      expect(response.statusCode, 'to be', 201)
      expect(JSON.parse(response.body).id, 'to be', 'some-id')
      expect(twilio.send.callCount, 'to be', 1)
    })

    it('respond 500 for internal error', async () => {
      userDao.getVerified.rejects(new Error('boom'))
      const response = await handler.createKey({ body: JSON.stringify({ phone }) })
      expect(response.statusCode, 'to be', 500)
      expect(console.error.callCount, 'to be', 1)
    })
  })

  describe('getKey', () => {
    it('handle empty params', async () => {
      const response = await handler.getKey({})
      expect(response.statusCode, 'to be', 400)
    })

    it('handle no verified user', async () => {
      userDao.setNewCode.resolves(null)
      const response = await handler.getKey({
        pathParameters: { keyId },
        queryStringParameters: { phone: encodeURIComponent(phone) }
      })
      expect(response.statusCode, 'to be', 404)
    })

    it('successfully request a key', async () => {
      userDao.setNewCode.resolves(code)
      const response = await handler.getKey({
        pathParameters: { keyId },
        queryStringParameters: { phone: encodeURIComponent(phone) }
      })
      expect(response.statusCode, 'to be', 200)
      expect(twilio.send.callCount, 'to be', 1)
    })

    it('respond 500 for internal error', async () => {
      userDao.setNewCode.rejects(new Error('boom'))
      const response = await handler.getKey({
        pathParameters: { keyId },
        queryStringParameters: { phone: encodeURIComponent(phone) }
      })
      expect(response.statusCode, 'to be', 500)
      expect(console.error.callCount, 'to be', 1)
    })
  })

  describe('verifyKey', () => {
    it('handle empty params', async () => {
      const response = await handler.verifyKey({})
      expect(response.statusCode, 'to be', 400)
    })

    it('handle no user found', async () => {
      userDao.verify.resolves({ user: null })
      const response = await handler.verifyKey({
        pathParameters: { keyId },
        body: JSON.stringify({ phone, code, op })
      })
      expect(response.statusCode, 'to be', 404)
    })

    it('rate limit brute force attack', async () => {
      userDao.verify.resolves({ user: null, delay: '2020-06-09T03:33:47.980Z' })
      const response = await handler.verifyKey({
        pathParameters: { keyId },
        body: JSON.stringify({ phone, code, op })
      })
      expect(response.statusCode, 'to be', 429)
      expect(JSON.parse(response.body).message, 'to match', /Rate limit/)
      expect(JSON.parse(response.body).delay, 'to be ok')
    })

    it('respond 500 if user remove fails', async () => {
      userDao.verify.resolves({ user: { keyId } })
      userDao.remove.rejects(new Error('boom'))
      const response = await handler.verifyKey({
        pathParameters: { keyId },
        body: JSON.stringify({ phone, code, op: 'remove' })
      })
      expect(response.statusCode, 'to be', 500)
      expect(userDao.remove.callCount, 'to be', 1)
      expect(keyDao.remove.callCount, 'to be', 0)
    })

    it('successfully verify key remove', async () => {
      userDao.verify.resolves({ user: { keyId } })
      const response = await handler.verifyKey({
        pathParameters: { keyId },
        body: JSON.stringify({ phone, code, op: 'remove' })
      })
      expect(response.statusCode, 'to be', 200)
      expect(userDao.remove.callCount, 'to be', 1)
      expect(keyDao.remove.callCount, 'to be', 1)
    })

    it('successfully verify key read', async () => {
      userDao.verify.resolves({ user: { keyId } })
      keyDao.get.resolves({ id: keyId })
      const response = await handler.verifyKey({
        pathParameters: { keyId },
        body: JSON.stringify({ phone, code, op })
      })
      expect(response.statusCode, 'to be', 200)
      expect(JSON.parse(response.body).id, 'to be', keyId)
    })

    it('respond 500 for internal error', async () => {
      userDao.verify.rejects(new Error('boom'))
      const response = await handler.verifyKey({
        pathParameters: { keyId },
        body: JSON.stringify({ phone, code, op })
      })
      expect(response.statusCode, 'to be', 500)
      expect(console.error.callCount, 'to be', 1)
    })
  })

  describe('removeKey', () => {
    it('handle empty params', async () => {
      const response = await handler.removeKey({})
      expect(response.statusCode, 'to be', 400)
    })

    it('handle no verified user', async () => {
      userDao.setNewCode.resolves(null)
      const response = await handler.removeKey({
        pathParameters: { keyId },
        queryStringParameters: { phone: encodeURIComponent(phone) }
      })
      expect(response.statusCode, 'to be', 404)
    })

    it('successfully request a key', async () => {
      userDao.setNewCode.resolves(code)
      const response = await handler.removeKey({
        pathParameters: { keyId },
        queryStringParameters: { phone: encodeURIComponent(phone) }
      })
      expect(response.statusCode, 'to be', 200)
      expect(twilio.send.callCount, 'to be', 1)
    })

    it('respond 500 for internal error', async () => {
      userDao.setNewCode.rejects(new Error('boom'))
      const response = await handler.removeKey({
        pathParameters: { keyId },
        queryStringParameters: { phone: encodeURIComponent(phone) }
      })
      expect(response.statusCode, 'to be', 500)
      expect(console.error.callCount, 'to be', 1)
    })
  })
})
