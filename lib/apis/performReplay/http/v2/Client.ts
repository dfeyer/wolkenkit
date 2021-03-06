import { AggregateIdentifier } from '../../../../common/elements/AggregateIdentifier';
import axios from 'axios';
import { ContextIdentifier } from '../../../../common/elements/ContextIdentifier';
import { errors } from '../../../../common/errors';
import { flaschenpost } from 'flaschenpost';
import { HttpClient } from '../../../shared/HttpClient';

const logger = flaschenpost.getLogger();

class Client extends HttpClient {
  public constructor ({ protocol = 'http', hostName, port, path = '/' }: {
    protocol?: string;
    hostName: string;
    port: number;
    path?: string;
  }) {
    super({ protocol, hostName, port, path });
  }

  public async performReplay ({ flowNames, aggregates }: {
    flowNames?: string[];
    aggregates: {
      contextIdentifier: ContextIdentifier;
      aggregateIdentifier: AggregateIdentifier;
      from: number;
      to: number;
    }[];
  }): Promise<void> {
    const { status, data } = await axios({
      method: 'post',
      url: `${this.url}/`,
      data: { flowNames, aggregates },
      validateStatus (): boolean {
        return true;
      }
    });

    if (status === 200) {
      return;
    }

    switch (data.code) {
      case 'ECONTEXTNOTFOUND': {
        throw new errors.ContextNotFound(data.message);
      }
      case 'EAGGREGATENOTFOUND': {
        throw new errors.AggregateNotFound(data.message);
      }
      case 'EFLOWNOTFOUND': {
        throw new errors.FlowNotFound(data.message);
      }
      default: {
        logger.error('An unknown error occured.', { ex: data, status });

        throw new errors.UnknownError();
      }
    }
  }
}

export { Client };
