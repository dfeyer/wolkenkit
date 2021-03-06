import { Infrastructure } from '../infrastructure';
import { Message } from '../types/Message';
import { Flow, FlowHandler } from 'wolkenkit';
import { LikedData, SentData } from '../domain/communication/message';

const messages: Flow = {
  replayPolicy: 'always',

  domainEventHandlers: {
    handleMessageSent: {
      isRelevant ({ fullyQualifiedName }) {
        return fullyQualifiedName === 'communication.message.sent';
      },

      async handle (domainEvent, { infrastructure }) {
        const message: Message = {
          id: domainEvent.aggregateIdentifier.id,
          timestamp: domainEvent.metadata.timestamp,
          text: domainEvent.data.text,
          likes: 0
        };

        if (Array.isArray(infrastructure.tell.viewStore.messages)) {
          infrastructure.tell.viewStore.messages.push(message);

          return;
        }

        await infrastructure.tell.viewStore.messages.insertOne(message);
      }
    } as FlowHandler<SentData, Infrastructure>,

    handleMessageLiked: {
      isRelevant ({ fullyQualifiedName }) {
        return fullyQualifiedName === 'communication.message.liked';
      },

      async handle (domainEvent, { infrastructure }) {
        if (Array.isArray(infrastructure.tell.viewStore.messages)) {
          const message = infrastructure.tell.viewStore.messages.find(
            (message): boolean => message.id === domainEvent.aggregateIdentifier.id);

          message.likes = domainEvent.data.likes;

          return;
        }

        await infrastructure.tell.viewStore.messages.updateOne(
          { id: domainEvent.aggregateIdentifier.id },
          { $set: { likes: domainEvent.data.likes }}
        );
      }
    } as FlowHandler<LikedData, Infrastructure>
  }
};

export default messages;
