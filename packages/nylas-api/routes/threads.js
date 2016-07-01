const Joi = require('joi');
const _ = require('underscore');
const Serialization = require('../serialization');
const {createSyncbackRequest, findFolderOrLabel} = require('../route-helpers')

module.exports = (server) => {
  server.route({
    method: 'GET',
    path: '/threads',
    config: {
      description: 'Returns threads',
      notes: 'Notes go here',
      tags: ['threads'],
      validate: {
        query: {
          'id': Joi.number().integer().min(0),
          'view': Joi.string().valid('expanded', 'count'),
          'subject': Joi.string(),
          'unread': Joi.boolean(),
          'starred': Joi.boolean(),
          'started_before': Joi.date().timestamp(),
          'started_after': Joi.date().timestamp(),
          'last_message_before': Joi.date().timestamp(),
          'last_message_after': Joi.date().timestamp(),
          'in': Joi.string().allow(Joi.number()),
          'filename': Joi.string(),
          'limit': Joi.number().integer().min(1).max(2000).default(100),
          'offset': Joi.number().integer().min(0).default(0),
        },
      },
      response: {
        schema: Joi.alternatives().try([
          Joi.array().items(
            Serialization.jsonSchema('Thread')
          ),
          Joi.object().keys({
            count: Joi.number().integer().min(0),
          }),
        ]),
      },
    },
    handler: (request, reply) => {
      request.getAccountDatabase().then((db) => {
        const {Thread, Folder, Label, Message, File} = db;
        const query = request.query;
        const where = {};
        const include = [];

        if (query.id) {
          where.id = query.id;
        }
        if (query.subject) {
          // the 'like' operator is case-insenstive in sequelite and for
          // non-binary strings in mysql
          where.subject = {like: query.subject};
        }

        // Boolean queries
        if (query.unread) {
          where.unreadCount = {gt: 0};
        } else if (query.unread !== undefined) {
          where.unreadCount = 0;
        }
        if (query.starred) {
          where.starredCount = {gt: 0};
        } else if (query.starred !== undefined) {
          where.starredCount = 0;
        }

        // Timestamp queries
        if (query.last_message_before) {
          where.lastMessageReceivedDate = {lt: query.last_message_before};
        }
        if (query.last_message_after) {
          if (where.lastMessageReceivedDate) {
            where.lastMessageReceivedDate.gt = query.last_message_after;
          } else {
            where.lastMessageReceivedDate = {gt: query.last_message_after};
          }
        }
        if (query.started_before) {
          where.firstMessageDate = {lt: query.started_before};
        }
        if (query.started_after) {
          if (where.firstMessageDate) {
            where.firstMessageDate.gt = query.started_after;
          } else {
            where.firstMessageDate = {gt: query.started_after};
          }
        }

        // Association queries
        let loadAssociatedModels = Promise.resolve();
        if (query.in) {
          loadAssociatedModels = findFolderOrLabel({Folder, Label}, query.in)
          .then((container) => {
            include.push({
              model: container.Model,
              where: {id: container.id},
            })
            include.push({model: container.Model === Folder ? Label : Folder})
          })
        } else {
          include.push({model: Folder})
          include.push({model: Label})
        }

        const messagesInclude = [];
        if (query.filename) {
          messagesInclude.push({
            model: File,
            where: {filename: query.filename},
          })
        }
        if (query.view === 'expanded') {
          include.push({
            model: Message,
            as: 'messages',
            attributes: _.without(Object.keys(Message.attributes), 'body'),
            include: messagesInclude,
          })
        } else {
          include.push({
            model: Message,
            as: 'messages',
            attributes: ['id'],
            include: messagesInclude,
          })
        }

        if (query.view === 'count') {
          loadAssociatedModels.then(() => {
            return Thread.count({
              where: where,
              include: include,
            }).then((count) => {
              reply(Serialization.jsonStringify({count: count}));
            });
          })
          return;
        }

        loadAssociatedModels.then(() => {
          Thread.findAll({
            limit: request.query.limit,
            offset: request.query.offset,
            where: where,
            include: include,
          }).then((threads) => {
            // if the user requested the expanded viw, fill message.folder using
            // thread.folders, since it must be a superset.
            if (query.view === 'expanded') {
              for (const thread of threads) {
                for (const msg of thread.messages) {
                  msg.folder = thread.folders.find(c => c.id === msg.folderId);
                }
              }
            }
            reply(Serialization.jsonStringify(threads));
          })
        })
      })
    },
  });

  server.route({
    method: 'PUT',
    path: '/threads/{id}',
    config: {
      description: 'Update a thread',
      notes: 'Can move between folders',
      tags: ['threads'],
      validate: {
        params: {
          id: Joi.string(),
          payload: {
            folder_id: Joi.string(),
          },
        },
      },
      response: {
        schema: Serialization.jsonSchema('SyncbackRequest'),
      },
    },
    handler: (request, reply) => {
      const payload = request.payload
      if (payload.folder_id) {
        createSyncbackRequest(request, reply, {
          type: "MoveToFolder",
          props: {
            folderId: request.payload.folder_id,
            threadId: request.params.id,
          },
        })
      }
      if (payload.unread === false) {
        createSyncbackRequest(request, reply, {
          type: "MarkThreadAsRead",
          props: {
            threadId: request.params.id,
          },
        })
      } else if (payload.unread === true) {
        createSyncbackRequest(request, reply, {
          type: "MarkThreadAsUnread",
          props: {
            threadId: request.params.id,
          },
        })
      }
      if (payload.starred === false) {
        createSyncbackRequest(request, reply, {
          type: "UnstarThread",
          props: {
            threadId: request.params.id,
          },
        })
      } else if (payload.starred === true) {
        createSyncbackRequest(request, reply, {
          type: "StarThread",
          props: {
            threadId: request.params.id,
          },
        })
      }
    },
  });
};
