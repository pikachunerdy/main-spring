_ = require 'underscore'

NylasAPI = require '../../src/flux/nylas-api'
Task = require '../../src/flux/tasks/task'
Actions = require '../../src/flux/actions'
Message = require '../../src/flux/models/message'
Account = require '../../src/flux/models/account'
Contact = require '../../src/flux/models/contact'
{APIError} = require '../../src/flux/errors'
DatabaseStore = require '../../src/flux/stores/database-store'
TaskQueue = require '../../src/flux/stores/task-queue'

SyncbackDraftTask = require '../../src/flux/tasks/syncback-draft'

inboxError =
  message: "No draft with public id bvn4aydxuyqlbmzowh4wraysg",
  type: "invalid_request_error"

testError = (opts) ->
  new APIError
    error:null
    response:{statusCode: 404}
    body:inboxError
    requestOptions: opts

testData =
  to: [new Contact(name: "Ben Gotow", email: "ben@nylas.com")]
  from: [new Contact(name: "Evan Morikawa", email: "evan@nylas.com")]
  date: new Date
  draft: true
  subject: "Test"
  accountId: "abc123"
  body: '<body>123</body>'

localDraft = -> new Message _.extend {}, testData, {clientId: "local-id"}
remoteDraft = -> new Message _.extend {}, testData, {clientId: "local-id", serverId: "remoteid1234"}

describe "SyncbackDraftTask", ->
  beforeEach ->
    spyOn(DatabaseStore, "findBy").andCallFake (klass, {clientId}) ->
      if klass is Account
        return Promise.resolve(new Account(clientId: 'local-abc123', serverId: 'abc123'))

      if clientId is "localDraftId" then Promise.resolve(localDraft())
      else if clientId is "remoteDraftId" then Promise.resolve(remoteDraft())
      else if clientId is "missingDraftId" then Promise.resolve()
      else return Promise.resolve()

    spyOn(DatabaseStore, "persistModel").andCallFake ->
      Promise.resolve()

  describe "performRemote", ->
    beforeEach ->
      spyOn(NylasAPI, 'makeRequest').andCallFake (opts) ->
        Promise.resolve(remoteDraft().toJSON())

    it "does nothing if no draft can be found in the db", ->
      task = new SyncbackDraftTask("missingDraftId")
      waitsForPromise =>
        task.performRemote().then ->
          expect(NylasAPI.makeRequest).not.toHaveBeenCalled()

    it "should start an API request with the Message JSON", ->
      task = new SyncbackDraftTask("localDraftId")
      waitsForPromise =>
        task.performRemote().then ->
          expect(NylasAPI.makeRequest).toHaveBeenCalled()
          reqBody = NylasAPI.makeRequest.mostRecentCall.args[0].body
          expect(reqBody.subject).toEqual testData.subject
          expect(reqBody.body).toEqual testData.body

    it "should do a PUT when the draft has already been saved", ->
      task = new SyncbackDraftTask("remoteDraftId")
      waitsForPromise =>
        task.performRemote().then ->
          expect(NylasAPI.makeRequest).toHaveBeenCalled()
          options = NylasAPI.makeRequest.mostRecentCall.args[0]
          expect(options.path).toBe("/drafts/remoteid1234")
          expect(options.accountId).toBe("abc123")
          expect(options.method).toBe('PUT')

    it "should do a POST when the draft is unsaved", ->
      task = new SyncbackDraftTask("localDraftId")
      waitsForPromise =>
        task.performRemote().then ->
          expect(NylasAPI.makeRequest).toHaveBeenCalled()
          options = NylasAPI.makeRequest.mostRecentCall.args[0]
          expect(options.path).toBe("/drafts")
          expect(options.accountId).toBe("abc123")
          expect(options.method).toBe('POST')

    it "should pass returnsModel:false so that the draft can be manually removed/added to the database, accounting for its ID change", ->
      task = new SyncbackDraftTask("localDraftId")
      waitsForPromise =>
        task.performRemote().then ->
          expect(NylasAPI.makeRequest).toHaveBeenCalled()
          options = NylasAPI.makeRequest.mostRecentCall.args[0]
          expect(options.returnsModel).toBe(false)

  describe "When the api throws a 404 error", ->
    beforeEach ->
      spyOn(NylasAPI, "makeRequest").andCallFake (opts) ->
        Promise.reject(testError(opts))
