/* eslint global-require: 0 */
/**
 * Given a `SyncbackRequestObject` it creates the appropriate syncback task.
 *
 */
class SyncbackTaskFactory {

  static create(account, syncbackRequest) {
    let Task = null;
    switch (syncbackRequest.type) {
      case "MoveThreadToFolder":
        Task = require('./syncback-tasks/move-thread-to-folder.imap'); break;
      case "SetThreadLabels":
        Task = require('./syncback-tasks/set-thread-labels.imap'); break;
      case "SetThreadFolderAndLabels":
        Task = require('./syncback-tasks/set-thread-folder-and-labels.imap'); break;
      case "MarkThreadAsRead":
        Task = require('./syncback-tasks/mark-thread-as-read.imap'); break;
      case "MarkThreadAsUnread":
        Task = require('./syncback-tasks/mark-thread-as-unread.imap'); break;
      case "StarThread":
        Task = require('./syncback-tasks/star-thread.imap'); break;
      case "UnstarThread":
        Task = require('./syncback-tasks/unstar-thread.imap'); break;
      case "MoveMessageToFolder":
        Task = require('./syncback-tasks/move-message-to-folder.imap'); break;
      case "SetMessageLabels":
        Task = require('./syncback-tasks/set-message-labels.imap'); break;
      case "MarkMessageAsRead":
        Task = require('./syncback-tasks/mark-message-as-read.imap'); break;
      case "MarkMessageAsUnread":
        Task = require('./syncback-tasks/mark-message-as-unread.imap'); break;
      case "StarMessage":
        Task = require('./syncback-tasks/star-message.imap'); break;
      case "UnstarMessage":
        Task = require('./syncback-tasks/unstar-message.imap'); break;
      case "CreateCategory":
        Task = require('./syncback-tasks/create-category.imap'); break;
      case "RenameFolder":
        Task = require('./syncback-tasks/rename-folder.imap'); break;
      case "RenameLabel":
        Task = require('./syncback-tasks/rename-label.imap'); break;
      case "DeleteFolder":
        Task = require('./syncback-tasks/delete-folder.imap'); break;
      case "DeleteLabel":
        Task = require('./syncback-tasks/delete-label.imap'); break;
      case "DeleteMessage":
        Task = require('./syncback-tasks/delete-message.imap'); break;
      case "SendMessage":
        Task = require('./syncback-tasks/send-message.imap'); break;
      case "SendMessagePerRecipient":
        Task = require('./syncback-tasks/send-message-per-recipient.imap'); break;
      case "EnsureMessageInSentFolder":
        Task = require('./syncback-tasks/ensure-message-in-sent-folder.imap'); break;
      default:
        throw new Error(`Task type not defined in syncback-task-factory: ${syncbackRequest.type}`)
    }
    return new Task(account, syncbackRequest)
  }
}

module.exports = SyncbackTaskFactory
