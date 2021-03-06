import { assert } from 'assertthat';
import { buildCommandWithMetadata } from '../../../../lib/common/utils/test/buildCommandWithMetadata';
import { Client } from '../../../../lib/apis/awaitItem/http/v2/Client';
import { CommandData } from '../../../../lib/common/elements/CommandData';
import { CommandWithMetadata } from '../../../../lib/common/elements/CommandWithMetadata';
import { createPriorityQueueStore } from '../../../../lib/stores/priorityQueueStore/createPriorityQueueStore';
import { CustomError } from 'defekt';
import { doesItemIdentifierWithClientMatchCommandWithMetadata } from '../../../../lib/common/domain/doesItemIdentifierWithClientMatchCommandWithMetadata';
import { Application as ExpressApplication } from 'express';
import { getApi } from '../../../../lib/apis/awaitItem/http';
import { getCommandWithMetadataSchema } from '../../../../lib/common/schemas/getCommandWithMetadataSchema';
import { getPromiseStatus } from '../../../../lib/common/utils/getPromiseStatus';
import { InMemoryPublisher } from '../../../../lib/messaging/pubSub/InMemory/InMemoryPublisher';
import { InMemorySubscriber } from '../../../../lib/messaging/pubSub/InMemory/InMemorySubscriber';
import { ItemIdentifierWithClient } from '../../../../lib/common/elements/ItemIdentifierWithClient';
import { PriorityQueueStore } from '../../../../lib/stores/priorityQueueStore/PriorityQueueStore';
import { Publisher } from '../../../../lib/messaging/pubSub/Publisher';
import { runAsServer } from '../../../shared/http/runAsServer';
import { sleep } from '../../../../lib/common/utils/sleep';
import { Subscriber } from '../../../../lib/messaging/pubSub/Subscriber';
import { uuid } from 'uuidv4';
import { Value } from 'validate-value';

suite('awaitItem/http/Client', (): void => {
  suite('/v2', (): void => {
    const expirationTime = 600;
    const pollInterval = 500;

    let api: ExpressApplication,
        newItemPublisher: Publisher<object>,
        newItemSubscriber: Subscriber<object>,
        newItemSubscriberChannel: string,
        priorityQueueStore: PriorityQueueStore<CommandWithMetadata<CommandData>, ItemIdentifierWithClient>;

    setup(async (): Promise<void> => {
      newItemSubscriber = await InMemorySubscriber.create();
      newItemSubscriberChannel = uuid();
      newItemPublisher = await InMemoryPublisher.create();

      priorityQueueStore = await createPriorityQueueStore({
        type: 'InMemory',
        doesIdentifierMatchItem: doesItemIdentifierWithClientMatchCommandWithMetadata,
        options: { expirationTime }
      });

      ({ api } = await getApi({
        corsOrigin: '*',
        priorityQueueStore,
        newItemSubscriber,
        newItemSubscriberChannel,
        validateOutgoingItem ({ item }: { item: any }): void {
          new Value(getCommandWithMetadataSchema()).validate(item);
        }
      }));
    });

    suite('awaitItem', (): void => {
      test('retrieves a lock item.', async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        const commandWithMetadata = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: uuid()
          },
          name: 'execute',
          data: {}
        });

        await priorityQueueStore.enqueue({
          item: commandWithMetadata,
          discriminator: 'foo',
          priority: commandWithMetadata.metadata.timestamp
        });
        await newItemPublisher.publish({
          channel: newItemSubscriberChannel,
          message: {}
        });

        const command = await client.awaitItem();

        assert.that(command.item).is.equalTo(commandWithMetadata);
        assert.that(command.metadata.token).is.ofType('string');
        assert.that(command.metadata.discriminator).is.equalTo('foo');
      });
    });

    suite('renewLock', (): void => {
      test('throws a request malformed error if the discriminator is too short.', async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        await assert.that(async (): Promise<any> => await client.renewLock({
          discriminator: '' as any,
          token: uuid()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'EREQUESTMALFORMED' &&
            ex.message === 'String is too short (0 chars), minimum 1 (at value.discriminator).'
        );
      });

      test(`throws an item not found error if the item doesn't exist.`, async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        await assert.that(async (): Promise<any> => client.renewLock({
          discriminator: uuid(),
          token: uuid()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'EITEMNOTFOUND'
        );
      });

      test(`throws an item not locked error if the item isn't locked.`, async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        const commandWithMetadata = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: uuid()
          },
          name: 'execute',
          data: {}
        });

        await priorityQueueStore.enqueue({
          item: commandWithMetadata,
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          priority: commandWithMetadata.metadata.timestamp
        });
        await newItemPublisher.publish({
          channel: newItemSubscriberChannel,
          message: {}
        });

        await assert.that(async (): Promise<any> => client.renewLock({
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          token: uuid()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'EITEMNOTLOCKED'
        );
      });

      test(`throws a token mismatched error if the token doesn't match.`, async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        const commandWithMetadata = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: uuid()
          },
          name: 'execute',
          data: {}
        });

        await priorityQueueStore.enqueue({
          item: commandWithMetadata,
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          priority: commandWithMetadata.metadata.timestamp
        });
        await newItemPublisher.publish({
          channel: newItemSubscriberChannel,
          message: {}
        });

        await client.awaitItem();

        await assert.that(async (): Promise<any> => client.renewLock({
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          token: uuid()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'ETOKENMISMATCH' &&
            ex.message === `Token mismatch for discriminator '${commandWithMetadata.aggregateIdentifier.id}'.`
        );
      });

      test('extends the lock expiry time.', async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        const commandWithMetadata = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: uuid()
          },
          name: 'execute',
          data: {}
        });

        await priorityQueueStore.enqueue({
          item: commandWithMetadata,
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          priority: commandWithMetadata.metadata.timestamp
        });
        await newItemPublisher.publish({
          channel: newItemSubscriberChannel,
          message: {}
        });

        const { item, metadata: { token }} = await client.awaitItem();

        await sleep({ ms: 0.6 * expirationTime });

        await client.renewLock({ discriminator: item.aggregateIdentifier.id, token });

        await sleep({ ms: 0.6 * expirationTime });

        const notResolvingPromise = client.awaitItem();

        await sleep({ ms: pollInterval });

        assert.that(await getPromiseStatus(notResolvingPromise)).is.equalTo('pending');
      });
    });

    suite('acknowledge', (): void => {
      test('throws a request malformed error if the discriminator is too short.', async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        await assert.that(async (): Promise<any> => await client.acknowledge({
          discriminator: '',
          token: uuid()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'EREQUESTMALFORMED' &&
            ex.message === 'String is too short (0 chars), minimum 1 (at value.discriminator).'
        );
      });

      test(`throws an item not found error if the item doesn't exist.`, async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        await assert.that(async (): Promise<any> => client.acknowledge({
          discriminator: uuid(),
          token: uuid()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'EITEMNOTFOUND'
        );
      });

      test(`throws an item not locked error if the item isn't locked.`, async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        const commandWithMetadata = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: uuid()
          },
          name: 'execute',
          data: {}
        });

        await priorityQueueStore.enqueue({
          item: commandWithMetadata,
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          priority: commandWithMetadata.metadata.timestamp
        });
        await newItemPublisher.publish({
          channel: newItemSubscriberChannel,
          message: {}
        });

        await assert.that(async (): Promise<any> => client.acknowledge({
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          token: uuid()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'EITEMNOTLOCKED'
        );
      });

      test(`throws a token mismatched error if the token doesn't match.`, async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        const commandWithMetadata = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: uuid()
          },
          name: 'execute',
          data: {}
        });

        await priorityQueueStore.enqueue({
          item: commandWithMetadata,
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          priority: commandWithMetadata.metadata.timestamp
        });
        await newItemPublisher.publish({
          channel: newItemSubscriberChannel,
          message: {}
        });

        await client.awaitItem();

        await assert.that(async (): Promise<any> => client.acknowledge({
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          token: uuid()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'ETOKENMISMATCH' &&
            ex.message === `Token mismatch for discriminator '${commandWithMetadata.aggregateIdentifier.id}'.`
        );
      });

      test('removes the item from the queue and lets the next item for the same aggregate pass.', async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        const aggregateId = uuid();
        const commandOne = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: aggregateId
          },
          name: 'execute',
          data: {}
        });
        const commandTwo = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: aggregateId
          },
          name: 'execute',
          data: {}
        });

        await priorityQueueStore.enqueue({
          item: commandOne,
          discriminator: commandOne.aggregateIdentifier.id,
          priority: commandOne.metadata.timestamp
        });
        await priorityQueueStore.enqueue({
          item: commandTwo,
          discriminator: commandTwo.aggregateIdentifier.id,
          priority: commandTwo.metadata.timestamp
        });

        const { item, metadata: { token }} = await client.awaitItem();

        const commandWithMetadata = new CommandWithMetadata(item);

        await client.acknowledge({
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          token
        });

        // This should resolve. A timeout in this test means, that this can not
        // fetch a command.
        await client.awaitItem();
      });
    });

    suite('defer', (): void => {
      test('throws a request malformed error if the discriminator is too short.', async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        await assert.that(async (): Promise<any> => await client.defer({
          discriminator: '',
          token: uuid(),
          priority: Date.now()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'EREQUESTMALFORMED' &&
            ex.message === 'String is too short (0 chars), minimum 1 (at value.discriminator).'
        );
      });

      test(`throws an item not found error if the item doesn't exist.`, async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        await assert.that(async (): Promise<any> => client.defer({
          discriminator: uuid(),
          token: uuid(),
          priority: Date.now()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'EITEMNOTFOUND'
        );
      });

      test(`throws an item not locked error if the item isn't locked.`, async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        const commandWithMetadata = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: uuid()
          },
          name: 'execute',
          data: {}
        });

        await priorityQueueStore.enqueue({
          item: commandWithMetadata,
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          priority: commandWithMetadata.metadata.timestamp
        });
        await newItemPublisher.publish({
          channel: newItemSubscriberChannel,
          message: {}
        });

        await assert.that(async (): Promise<any> => client.defer({
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          token: uuid(),
          priority: Date.now()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'EITEMNOTLOCKED'
        );
      });

      test(`throws a token mismatched error if the token doesn't match.`, async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        const commandWithMetadata = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: uuid()
          },
          name: 'execute',
          data: {}
        });

        await priorityQueueStore.enqueue({
          item: commandWithMetadata,
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          priority: commandWithMetadata.metadata.timestamp
        });
        await newItemPublisher.publish({
          channel: newItemSubscriberChannel,
          message: {}
        });

        await client.awaitItem();

        await assert.that(async (): Promise<any> => client.defer({
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          token: uuid(),
          priority: Date.now()
        })).is.throwingAsync(
          (ex): boolean => (ex as CustomError).code === 'ETOKENMISMATCH' &&
                ex.message === `Token mismatch for discriminator '${commandWithMetadata.aggregateIdentifier.id}'.`
        );
      });

      test('removes the item from the queue and lets the next item for the same aggregate pass.', async (): Promise<void> => {
        const { port } = await runAsServer({ app: api });
        const client = new Client<CommandWithMetadata<CommandData>>({
          hostName: 'localhost',
          port,
          path: '/v2',
          createItemInstance: ({ item }: { item: CommandWithMetadata<CommandData> }): CommandWithMetadata<CommandData> => new CommandWithMetadata<CommandData>(item)
        });

        const aggregateId = uuid();
        const commandOne = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: aggregateId
          },
          name: 'execute',
          data: {}
        });
        const commandTwo = buildCommandWithMetadata({
          contextIdentifier: {
            name: 'sampleContext'
          },
          aggregateIdentifier: {
            name: 'sampleAggregate',
            id: aggregateId
          },
          name: 'execute',
          data: {}
        });

        await priorityQueueStore.enqueue({
          item: commandOne,
          discriminator: commandOne.aggregateIdentifier.id,
          priority: commandOne.metadata.timestamp
        });
        await priorityQueueStore.enqueue({
          item: commandTwo,
          discriminator: commandTwo.aggregateIdentifier.id,
          priority: commandTwo.metadata.timestamp
        });

        const { item, metadata: { token }} = await client.awaitItem();

        const commandWithMetadata = new CommandWithMetadata(item);

        await client.defer({
          discriminator: commandWithMetadata.aggregateIdentifier.id,
          token,
          priority: Date.now()
        });

        const { item: nextItem, metadata: { token: nextToken }} = await client.awaitItem();

        const nextCommandWithMetadata = new CommandWithMetadata(nextItem);

        await client.acknowledge({
          discriminator: nextCommandWithMetadata.aggregateIdentifier.id,
          token: nextToken
        });

        // This should resolve. A timeout in this test means, that this can not
        // fetch a command.
        await client.awaitItem();
      });
    });
  });
});
