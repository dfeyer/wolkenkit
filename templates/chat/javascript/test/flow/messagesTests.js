'use strict';

const { assert } = require('assertthat');
const path = require('path');
const { uuid } = require('uuidv4');
const { loadApplication, sandbox } = require('wolkenkit');

suite('messages', () => {
  let application;

  setup(async () => {
    application = await loadApplication({
      applicationDirectory: path.join(__dirname, '..', '..')
    });
  });

  test('adds sent messages to the messages view.', async () => {
    const aggregateId = uuid(),
          text = 'Hello world!',
          timestamp = Date.now();

    await sandbox().
      withApplication({ application }).
      forFlow({ flowName: 'messages' }).
      when({
        contextIdentifier: { name: 'communication' },
        aggregateIdentifier: { name: 'message', id: aggregateId },
        name: 'sent',
        data: { text },
        metadata: {
          revision: 1,
          timestamp
        }
      }).
      then(async () => {
        const messages = application.infrastructure.tell.viewStore.messages;

        assert.that(messages.length).is.equalTo(1);
        assert.that(messages[0]).is.equalTo({
          id: aggregateId,
          timestamp,
          text,
          likes: 0
        });
      });
  });

  test('increases likes.', async () => {
    const aggregateId = uuid();

    await sandbox().
      withApplication({ application }).
      forFlow({ flowName: 'messages' }).
      when({
        contextIdentifier: { name: 'communication' },
        aggregateIdentifier: { name: 'message', id: aggregateId },
        name: 'sent',
        data: { text: 'Hello world!' },
        metadata: {
          revision: 1
        }
      }).
      and({
        contextIdentifier: { name: 'communication' },
        aggregateIdentifier: { name: 'message', id: aggregateId },
        name: 'liked',
        data: { likes: 5 },
        metadata: {
          revision: 2
        }
      }).
      then(async () => {
        const messages = application.infrastructure.tell.viewStore.messages;

        assert.that(messages.length).is.equalTo(1);
        assert.that(messages[0]).is.atLeast({
          id: aggregateId,
          likes: 5
        });
      });
  });
});
