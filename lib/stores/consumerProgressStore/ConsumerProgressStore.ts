import { AggregateIdentifier } from '../../common/elements/AggregateIdentifier';
import { IsReplaying } from './IsReplaying';

export interface ConsumerProgressStore {
  getProgress: ({ consumerId, aggregateIdentifier }: {
    consumerId: string;
    aggregateIdentifier: AggregateIdentifier;
  }) => Promise<{ revision: number; isReplaying: IsReplaying }>;

  setProgress: ({ consumerId, aggregateIdentifier, revision }: {
    consumerId: string;
    aggregateIdentifier: AggregateIdentifier;
    revision: number;
  }) => Promise<void>;

  resetProgress: ({ consumerId }: {
    consumerId: string;
  }) => Promise<void>;

  setIsReplaying: ({ isReplaying }: {
    isReplaying: IsReplaying;
  }) => Promise<void>;

  destroy: () => Promise<void>;
}
