/* eslint global-require: 0 */
import Task from './task';
import Actions from '../actions';
import Message from '../models/message';
import Account from '../models/account';
import NylasAPI from '../nylas-api';
import * as NylasAPIHelpers from '../nylas-api-helpers';
import {APIError, RequestEnsureOnceError} from '../errors';
import SoundRegistry from '../../registries/sound-registry';
import DatabaseStore from '../stores/database-store';
import AccountStore from '../stores/account-store';
import BaseDraftTask from './base-draft-task';
import SyncbackMetadataTask from './syncback-metadata-task';
import EnsureMessageInSentFolderTask from './ensure-message-in-sent-folder-task';

const OPEN_TRACKING_ID = NylasEnv.packages.pluginIdFor('open-tracking')
const LINK_TRACKING_ID = NylasEnv.packages.pluginIdFor('link-tracking')

export default class SendDraftTask extends BaseDraftTask {

  constructor(draftId, {playSound = true, emitError = true, allowMultiSend = true} = {}) {
    super(draftId);
    this.draft = null;
    this.message = null;
    this.emitError = emitError
    this.playSound = playSound
    this.allowMultiSend = allowMultiSend
  }

  label() {
    return "Sending message";
  }

  performLocal() {
    return super.performLocal()
    .then(() => {
      this._timerKey = `send-draft-${this.draftId}`
      NylasEnv.timer.start(this._timerKey)
    })
  }

  performRemote() {
    return this.refreshDraftReference()
    .then(this.assertDraftValidity)
    .then(this.sendMessage)
    .then(this.ensureInSentFolder)
    .then(this.updatePluginMetadata)
    .then(this.onSuccess)
    .catch(this.onError);
  }

  assertDraftValidity = () => {
    if (!this.draft.from[0]) {
      return Promise.reject(new Error("SendDraftTask - you must populate `from` before sending."));
    }

    const account = AccountStore.accountForEmail(this.draft.from[0].email);
    if (!account) {
      return Promise.reject(new Error("SendDraftTask - you can only send drafts from a configured account."));
    }
    if (this.draft.accountId !== account.id) {
      return Promise.reject(new Error("The from address has changed since you started sending this draft. Double-check the draft and click 'Send' again."));
    }
    return Promise.resolve();
  }

  _trackingPluginsInUse() {
    const pluginsAvailable = (OPEN_TRACKING_ID && LINK_TRACKING_ID);
    if (!pluginsAvailable) {
      return false;
    }
    return (!!this.draft.metadataForPluginId(OPEN_TRACKING_ID) || !!this.draft.metadataForPluginId(LINK_TRACKING_ID)) || false;
  }

  hasCustomBodyPerRecipient = () => {
    if (!this.allowMultiSend) {
      return false;
    }

    // Sending individual bodies for too many participants can cause us
    // to hit the smtp rate limit.
    const participants = this.draft.participants({includeFrom: false, includeBcc: true})
    if (participants.length === 1 || participants.length > 10) {
      return false;
    }

    const providerCompatible = (AccountStore.accountForId(this.draft.accountId).provider !== "eas");
    return this._trackingPluginsInUse() && providerCompatible;
  }

  sendMessage = async () => {
    if (this.hasCustomBodyPerRecipient()) {
      await this._sendPerRecipient();
    } else {
      await this._sendWithSingleBody()
    }
  }

  ensureInSentFolder = () => {
    const t = new EnsureMessageInSentFolderTask({
      message: this.message,
      customSentMessage: this.hasCustomBodyPerRecipient() || this._trackingPluginsInUse(),
    })
    Actions.queueTask(t)
  }

  _sendWithSingleBody = async () => {
    let responseJSON = {}
    if (this._syncbackRequestId) {
      responseJSON = await SyncbackTaskAPIRequest.waitForQueuedRequest(this._syncbackRequestId)
    } else {
      const task = new SyncbackTaskAPIRequest({
        api: NylasAPI,
        options: {
          path: "/send",
          accountId: this.draft.accountId,
          method: 'POST',
          body: this.draft.toJSON(),
          timeout: 1000 * 60 * 5, // We cannot hang up a send - won't know if it sent
          requestId: this.draft.id,
          onSyncbackRequestCreated: (syncbackRequest) => {
            this._syncbackRequestId = syncbackRequest.id
          },
        },
      })
      responseJSON = await task.run();
    }
    await this._createMessageFromResponse(responseJSON)
  }

  _sendPerRecipient = async () => {
    let responseJSON = {}
    if (this._syncbackRequestId) {
      responseJSON = await SyncbackTaskAPIRequest.waitForQueuedRequest(this._syncbackRequestId)
    } else {
      const task = new SyncbackTaskAPIRequest({
        api: NylasAPI,
        options: {
          path: "/send-per-recipient",
          accountId: this.draft.accountId,
          method: 'POST',
          body: {
            message: this.draft.toJSON(),
            uses_open_tracking: this.draft.metadataForPluginId(OPEN_TRACKING_ID) != null,
            uses_link_tracking: this.draft.metadataForPluginId(LINK_TRACKING_ID) != null,
          },
          timeout: 1000 * 60 * 5, // We cannot hang up a send - won't know if it sent
          onSyncbackRequestCreated: (syncbackRequest) => {
            this._syncbackRequestId = syncbackRequest.id
          },
        },
      })
      responseJSON = await task.run();
    }
    await this._createMessageFromResponse(responseJSON);
  }

  updatePluginMetadata = () => {
    this.message.pluginMetadata.forEach((m) => {
      const t1 = new SyncbackMetadataTask(this.message.id,
          this.message.constructor.name, m.pluginId);
      Actions.queueTask(t1);
    });

    return Promise.resolve();
  }

  _createMessageFromResponse = (responseJSON) => {
    const {failedRecipients, message} = responseJSON
    if (failedRecipients && failedRecipients.length > 0) {
      const errorMessage = `We had trouble sending this message to all recipients. ${failedRecipients} may not have received this email.`;
      NylasEnv.showErrorDialog(errorMessage, {showInMainWindow: true});
    }
    if (!message || !message.id || !message.account_id) {
      const errorMessage = `Your message successfully sent; however, we had trouble saving your message, "${message.subject}", to your Sent folder.`;
      if (!message) {
        throw new Error(`${errorMessage}\n\nError: Did not return message`)
      }
      if (!message.id) {
        throw new Error(`${errorMessage}\n\nError: Returned a message without id`)
      }
      if (!message.accountId) {
        throw new Error(`${errorMessage}\n\nError: Returned a message without accountId`)
      }
    }

    this.message = new Message().fromJSON(message);
    this.message.id = this.draft.id;
    this.message.body = this.draft.body;
    this.message.draft = false;
    this.message.clonePluginMetadataFrom(this.draft);

    return DatabaseStore.inTransaction((t) =>
      this.refreshDraftReference().then(() => {
        return t.persistModel(this.message);
      })
    );
  }

  onSuccess = () => {
    Actions.recordUserEvent("Draft Sent")
    Actions.draftDeliverySucceeded({message: this.message, messageId: this.message.id, draftId: this.draft.id});
    // TODO we shouldn't need to do this anymore
    NylasAPIHelpers.makeDraftDeletionRequest(this.draft);

    // Play the sending sound
    if (this.playSound && NylasEnv.config.get("core.sending.sounds")) {
      SoundRegistry.playSound('send');
    }
    if (NylasEnv.timer.isPending(this._timerKey)) {
      const account = AccountStore.accountForId(this.draft.accountId)
      const provider = account ? account.provider : 'Unknown provider'
      Actions.recordPerfMetric({
        provider,
        action: 'send-draft',
        actionTimeMs: NylasEnv.timer.stop(this._timerKey),
        maxValue: 60 * 1000,
        succeeded: true,
      })
    }
    return Promise.resolve(Task.Status.Success);
  }

  onError = (err) => {
    if (NylasEnv.timer.isPending(this._timerKey)) {
      const account = AccountStore.accountForId(this.draft.accountId)
      const provider = account ? account.provider : 'Unknown provider'
      Actions.recordPerfMetric({
        provider,
        action: 'send-draft',
        actionTimeMs: NylasEnv.timer.stop(this._timerKey),
        maxValue: 60 * 1000,
        succeeded: false,
      })
    }
    if (err instanceof BaseDraftTask.DraftNotFoundError) {
      return Promise.resolve(Task.Status.Continue);
    }

    let message = err.message;

    // TODO Handle errors in a cleaner way
    if (err instanceof APIError) {
      const errorMessage = (err.body && err.body.message) || ''
      message = `Sorry, this message could not be sent, please try again.`;
      message += `\n\nReason: ${err.message}`
      if (errorMessage.includes('unable to reach your SMTP server')) {
        message = `Sorry, this message could not be sent. There was a network error, please make sure you are online.`
      }
      if (errorMessage.includes('Incorrect SMTP username or password') ||
          errorMessage.includes('SMTP protocol error') ||
          errorMessage.includes('unable to look up your SMTP host')) {
        Actions.updateAccount(this.draft.accountId, {syncState: Account.SYNC_STATE_AUTH_FAILED})
        message = `Sorry, this message could not be sent due to an authentication error. Please re-authenticate your account and try again.`
      }
      if (err.statusCode === 402) {
        if (errorMessage.includes('at least one recipient')) {
          message = `This message could not be delivered to at least one recipient. (Note: other recipients may have received this message - you should check Sent Mail before re-sending this message.)`;
        } else {
          message = `Sorry, this message could not be sent because it was rejected by your mail provider. (${errorMessage})`;
          if (err.body.server_error) {
            message += `\n\n${err.body.server_error}`;
          }
        }
      }
    }

    if (this.emitError) {
      if (err instanceof RequestEnsureOnceError) {
        Actions.draftDeliveryFailed({
          threadId: this.draft.threadId,
          draftId: this.draft.id,
          errorMessage: `WARNING: Your message MIGHT have sent. We encountered a network problem while the send was in progress. Please wait a few minutes then check your sent folder and try again if necessary.`,
          errorDetail: `Please email support@nylas.com if you see this error message.`,
        });
      } else {
        Actions.draftDeliveryFailed({
          threadId: this.draft.threadId,
          draftId: this.draft.id,
          errorMessage: message,
          errorDetail: err.message + (err.error ? err.error.stack : '') + err.stack,
        });
      }
    }
    Actions.recordUserEvent("Draft Sending Errored", {
      error: err.message,
      errorClass: err.constructor.name,
    })
    err.message = `Send failed (client): ${err.message}`
    NylasEnv.reportError(err);

    return Promise.resolve([Task.Status.Failed, err]);
  }
}
