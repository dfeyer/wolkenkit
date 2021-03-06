import { asJsonStream } from '../../../../shared/http/asJsonStream';
import { assert } from 'assertthat';
import { Client as AwaitDomainEventClient } from '../../../../../lib/apis/awaitItem/http/v2/Client';
import { buildCommandWithMetadata } from '../../../../../lib/common/utils/test/buildCommandWithMetadata';
import { DomainEvent } from '../../../../../lib/common/elements/DomainEvent';
import { DomainEventData } from '../../../../../lib/common/elements/DomainEventData';
import { getAvailablePorts } from '../../../../../lib/common/utils/network/getAvailablePorts';
import { getTestApplicationDirectory } from '../../../../shared/applications/getTestApplicationDirectory';
import { Client as HandleCommandWithMetadataClient } from '../../../../../lib/apis/handleCommandWithMetadata/http/v2/Client';
import { Client as HealthClient } from '../../../../../lib/apis/getHealth/http/v2/Client';
import { Client as QueryDomainEventStoreClient } from '../../../../../lib/apis/queryDomainEventStore/http/v2/Client';
import { startProcess } from '../../../../../lib/runtimes/shared/startProcess';
import { Client as SubscribeMessagesClient } from '../../../../../lib/apis/subscribeMessages/http/v2/Client';
import { uuid } from 'uuidv4';

suite('domain', function (): void {
  this.timeout(10_000);

  const applicationDirectory = getTestApplicationDirectory({ name: 'base' });

  const publisherChannelNewDomainEvent = 'newDomainEvent',
        queueLockExpirationTime = 600,
        queuePollInterval = 600;

  let commandDispatcherHealthPort: number,
      commandDispatcherPort: number,
      domainEventDispatcherHealthPort: number,
      domainEventDispatcherPort: number,
      domainEventStoreHealthPort: number,
      domainEventStorePort: number,
      domainHealthPort: number,
      handleCommandWithMetadataClient: HandleCommandWithMetadataClient,
      publisherHealthPort: number,
      publisherPort: number,
      queryDomainEventStoreClient: QueryDomainEventStoreClient,
      stopCommandDispatcherProcess: (() => Promise<void>) | undefined,
      stopDomainEventDispatcherProcess: (() => Promise<void>) | undefined,
      stopDomainEventStoreProcess: (() => Promise<void>) | undefined,
      stopDomainProcess: (() => Promise<void>) | undefined,
      stopPublisherProcess: (() => Promise<void>) | undefined,
      subscribeMessagesClient: SubscribeMessagesClient;

  setup(async (): Promise<void> => {
    [
      commandDispatcherPort,
      commandDispatcherHealthPort,
      domainEventDispatcherPort,
      domainEventDispatcherHealthPort,
      domainEventStorePort,
      domainEventStoreHealthPort,
      domainHealthPort,
      publisherPort,
      publisherHealthPort
    ] = await getAvailablePorts({ count: 9 });

    stopCommandDispatcherProcess = await startProcess({
      runtime: 'microservice',
      name: 'commandDispatcher',
      enableDebugMode: false,
      port: commandDispatcherHealthPort,
      env: {
        APPLICATION_DIRECTORY: applicationDirectory,
        PRIORITY_QUEUE_STORE_OPTIONS: `{"expirationTime":${queueLockExpirationTime}}`,
        PORT: String(commandDispatcherPort),
        HEALTH_PORT: String(commandDispatcherHealthPort),
        QUEUE_POLL_INTERVAL: String(queuePollInterval)
      }
    });

    handleCommandWithMetadataClient = new HandleCommandWithMetadataClient({
      protocol: 'http',
      hostName: 'localhost',
      port: commandDispatcherPort,
      path: '/handle-command/v2'
    });

    stopDomainEventDispatcherProcess = await startProcess({
      runtime: 'microservice',
      name: 'domainEventDispatcher',
      enableDebugMode: false,
      port: domainEventDispatcherHealthPort,
      env: {
        APPLICATION_DIRECTORY: applicationDirectory,
        PRIORITY_QUEUE_STORE_OPTIONS: `{"expirationTime":${queueLockExpirationTime}}`,
        PORT: String(domainEventDispatcherPort),
        HEALTH_PORT: String(domainEventDispatcherHealthPort),
        QUEUE_POLL_INTERVAL: String(queuePollInterval)
      }
    });

    stopDomainEventStoreProcess = await startProcess({
      runtime: 'microservice',
      name: 'domainEventStore',
      enableDebugMode: false,
      port: domainEventStoreHealthPort,
      env: {
        PORT: String(domainEventStorePort),
        HEALTH_PORT: String(domainEventStoreHealthPort)
      }
    });

    queryDomainEventStoreClient = new QueryDomainEventStoreClient({
      protocol: 'http',
      hostName: 'localhost',
      port: domainEventStorePort,
      path: '/query/v2'
    });

    stopPublisherProcess = await startProcess({
      runtime: 'microservice',
      name: 'publisher',
      enableDebugMode: false,
      port: publisherHealthPort,
      env: {
        PORT: String(publisherPort),
        HEALTH_PORT: String(publisherHealthPort)
      }
    });

    subscribeMessagesClient = new SubscribeMessagesClient({
      protocol: 'http',
      hostName: 'localhost',
      port: publisherPort,
      path: '/subscribe/v2'
    });

    stopDomainProcess = await startProcess({
      runtime: 'microservice',
      name: 'domain',
      enableDebugMode: false,
      port: domainHealthPort,
      env: {
        APPLICATION_DIRECTORY: applicationDirectory,
        COMMAND_DISPATCHER_PROTOCOL: 'http',
        COMMAND_DISPATCHER_HOST_NAME: 'localhost',
        COMMAND_DISPATCHER_PORT: String(commandDispatcherPort),
        COMMAND_DISPATCHER_RENEW_INTERVAL: String(5_000),
        COMMAND_DISPATCHER_ACKNOWLEDGE_RETRIES: String(0),
        DOMAIN_EVENT_DISPATCHER_PROTOCOL: 'http',
        DOMAIN_EVENT_DISPATCHER_HOST_NAME: 'localhost',
        DOMAIN_EVENT_DISPATCHER_PORT: String(domainEventDispatcherPort),
        PUBLISHER_PROTOCOL: 'http',
        PUBLISHER_HOST_NAME: 'localhost',
        PUBLISHER_PORT: String(publisherPort),
        PUBLISHER_CHANNEL_NEW_DOMAIN_EVENT: publisherChannelNewDomainEvent,
        AEONSTORE_PROTOCOL: 'http',
        AEONSTORE_HOST_NAME: 'localhost',
        AEONSTORE_PORT: String(domainEventStorePort),
        AEONSTORE_RETRIES: String(0),
        HEALTH_PORT: String(domainHealthPort),
        CONCURRENT_COMMANDS: String(1),
        SNAPSHOT_STRATEGY: `{"name":"never"}`
      }
    });
  });

  teardown(async (): Promise<void> => {
    if (stopCommandDispatcherProcess) {
      await stopCommandDispatcherProcess();
    }
    if (stopDomainEventDispatcherProcess) {
      await stopDomainEventDispatcherProcess();
    }
    if (stopDomainEventStoreProcess) {
      await stopDomainEventStoreProcess();
    }
    if (stopPublisherProcess) {
      await stopPublisherProcess();
    }
    if (stopDomainProcess) {
      await stopDomainProcess();
    }

    stopCommandDispatcherProcess = undefined;
    stopDomainEventDispatcherProcess = undefined;
    stopDomainEventStoreProcess = undefined;
    stopPublisherProcess = undefined;
    stopDomainProcess = undefined;
  });

  suite('getHealth', (): void => {
    test('is using the health API.', async (): Promise<void> => {
      const healthClient = new HealthClient({
        protocol: 'http',
        hostName: 'localhost',
        port: domainHealthPort,
        path: '/health/v2'
      });

      await assert.that(
        async (): Promise<any> => healthClient.getHealth()
      ).is.not.throwingAsync();
    });
  });

  suite('authorization', (): void => {
    test(`publishes (and does not store) a rejected event if the sender of a command is not authorized.`, async (): Promise<void> => {
      const aggregateIdentifier = {
        name: 'sampleAggregate',
        id: uuid()
      };

      const command = buildCommandWithMetadata({
        contextIdentifier: {
          name: 'sampleContext'
        },
        aggregateIdentifier,
        name: 'authorize',
        data: {
          shouldAuthorize: false
        }
      });

      const messageStream = await subscribeMessagesClient.getMessages({
        channel: publisherChannelNewDomainEvent
      });

      await handleCommandWithMetadataClient.postCommand({ command });

      await new Promise((resolve, reject): void => {
        messageStream.on('error', (err: any): void => {
          reject(err);
        });
        messageStream.on('close', (): void => {
          resolve();
        });
        messageStream.pipe(asJsonStream(
          [
            (data): void => {
              try {
                assert.that(data).is.atLeast({
                  contextIdentifier: {
                    name: 'sampleContext'
                  },
                  aggregateIdentifier,
                  name: 'authorizeRejected',
                  data: {
                    reason: 'Command not authorized.'
                  }
                });
                resolve();
              } catch (ex) {
                reject(ex);
              }
            },
            (): void => {
              reject(new Error('Should only have received one message.'));
            }
          ],
          true
        ));
      });

      assert.that(
        await queryDomainEventStoreClient.getLastDomainEvent({ aggregateIdentifier })
      ).is.undefined();
    });
  });

  suite('handling', (): void => {
    test('publishes (and stores) an appropriate event for the incoming command.', async (): Promise<void> => {
      const aggregateIdentifier = {
        name: 'sampleAggregate',
        id: uuid()
      };

      const command = buildCommandWithMetadata({
        contextIdentifier: {
          name: 'sampleContext'
        },
        aggregateIdentifier,
        name: 'execute',
        data: {
          strategy: 'succeed'
        }
      });

      const messageStreamNewDomainEvent = await subscribeMessagesClient.getMessages({
        channel: publisherChannelNewDomainEvent
      });

      await handleCommandWithMetadataClient.postCommand({ command });

      await new Promise((resolve, reject): void => {
        messageStreamNewDomainEvent.on('error', (err: any): void => {
          reject(err);
        });
        messageStreamNewDomainEvent.on('close', (): void => {
          resolve();
        });
        messageStreamNewDomainEvent.pipe(asJsonStream(
          [
            (data): void => {
              try {
                assert.that(data).is.atLeast({
                  contextIdentifier: {
                    name: 'sampleContext'
                  },
                  aggregateIdentifier,
                  name: 'succeeded',
                  data: {}
                });
                resolve();
              } catch (ex) {
                reject(ex);
              }
            },
            (data): void => {
              try {
                assert.that(data).is.atLeast({
                  contextIdentifier: {
                    name: 'sampleContext'
                  },
                  aggregateIdentifier,
                  name: 'executed',
                  data: {
                    strategy: 'succeed'
                  }
                });
                resolve();
              } catch (ex) {
                reject(ex);
              }
            },
            (): void => {
              reject(new Error('Should only have received two messages.'));
            }
          ],
          true
        ));
      });

      const awaitDomainEventClient = new AwaitDomainEventClient<DomainEvent<DomainEventData>>({
        protocol: 'http',
        hostName: 'localhost',
        port: domainEventDispatcherPort,
        path: '/await-domain-event/v2',
        createItemInstance: ({ item }): DomainEvent<DomainEventData> => new DomainEvent<DomainEventData>(item)
      });

      let { item, metadata } = await awaitDomainEventClient.awaitItem();

      assert.that(item).is.atLeast({
        contextIdentifier: {
          name: 'sampleContext'
        },
        aggregateIdentifier,
        name: 'succeeded',
        data: {}
      });

      await awaitDomainEventClient.acknowledge({
        discriminator: metadata.discriminator,
        token: metadata.token
      });

      ({ item, metadata } = await awaitDomainEventClient.awaitItem());

      assert.that(item).is.atLeast({
        contextIdentifier: {
          name: 'sampleContext'
        },
        aggregateIdentifier,
        name: 'executed',
        data: {
          strategy: 'succeed'
        }
      });

      await awaitDomainEventClient.acknowledge({
        discriminator: metadata.discriminator,
        token: metadata.token
      });

      const eventStream = await queryDomainEventStoreClient.getReplayForAggregate({ aggregateId: aggregateIdentifier.id });

      await new Promise((resolve, reject): void => {
        eventStream.on('error', (err: any): void => {
          reject(err);
        });
        eventStream.on('close', (): void => {
          resolve();
        });
        eventStream.pipe(asJsonStream(
          [
            (data): void => {
              try {
                assert.that(data).is.atLeast({
                  contextIdentifier: {
                    name: 'sampleContext'
                  },
                  aggregateIdentifier,
                  name: 'succeeded',
                  data: {}
                });
                resolve();
              } catch (ex) {
                reject(ex);
              }
            },
            (data): void => {
              try {
                assert.that(data).is.atLeast({
                  contextIdentifier: {
                    name: 'sampleContext'
                  },
                  aggregateIdentifier,
                  name: 'executed',
                  data: {
                    strategy: 'succeed'
                  }
                });
                resolve();
              } catch (ex) {
                reject(ex);
              }
            },
            (): void => {
              reject(new Error('Should only have received two messages.'));
            }
          ],
          true
        ));
      });
    });

    test('handles multiple events in independent aggregates after each other.', async (): Promise<void> => {
      const command1 = buildCommandWithMetadata({
        contextIdentifier: {
          name: 'sampleContext'
        },
        aggregateIdentifier: {
          name: 'sampleAggregate',
          id: uuid()
        },
        name: 'execute',
        data: {
          strategy: 'succeed'
        }
      });
      const command2 = buildCommandWithMetadata({
        contextIdentifier: {
          name: 'sampleContext'
        },
        aggregateIdentifier: {
          name: 'sampleAggregate',
          id: uuid()
        },
        name: 'execute',
        data: {
          strategy: 'succeed'
        }
      });

      const messageStream = await subscribeMessagesClient.getMessages({
        channel: publisherChannelNewDomainEvent
      });

      await handleCommandWithMetadataClient.postCommand({ command: command1 });
      await handleCommandWithMetadataClient.postCommand({ command: command2 });

      await new Promise((resolve, reject): void => {
        messageStream.on('error', (err: any): void => {
          reject(err);
        });
        messageStream.on('close', (): void => {
          resolve();
        });
        messageStream.pipe(asJsonStream(
          [
            (data): void => {
              try {
                assert.that(data).is.atLeast({
                  contextIdentifier: {
                    name: 'sampleContext'
                  },
                  aggregateIdentifier: command1.aggregateIdentifier,
                  name: 'succeeded',
                  data: {}
                });
                resolve();
              } catch (ex) {
                reject(ex);
              }
            },
            (data): void => {
              try {
                assert.that(data).is.atLeast({
                  contextIdentifier: {
                    name: 'sampleContext'
                  },
                  aggregateIdentifier: command1.aggregateIdentifier,
                  name: 'executed',
                  data: {
                    strategy: 'succeed'
                  }
                });
                resolve();
              } catch (ex) {
                reject(ex);
              }
            },
            (data): void => {
              try {
                assert.that(data).is.atLeast({
                  contextIdentifier: {
                    name: 'sampleContext'
                  },
                  aggregateIdentifier: command2.aggregateIdentifier,
                  name: 'succeeded',
                  data: {}
                });
                resolve();
              } catch (ex) {
                reject(ex);
              }
            },
            (data): void => {
              try {
                assert.that(data).is.atLeast({
                  contextIdentifier: {
                    name: 'sampleContext'
                  },
                  aggregateIdentifier: command2.aggregateIdentifier,
                  name: 'executed',
                  data: {
                    strategy: 'succeed'
                  }
                });
                resolve();
              } catch (ex) {
                reject(ex);
              }
            },
            (): void => {
              reject(new Error('Should only have received four messages.'));
            }
          ],
          true
        ));
      });
    });
  });
});
