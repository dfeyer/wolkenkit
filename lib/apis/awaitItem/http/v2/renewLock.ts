import { errors } from '../../../../common/errors';
import { flaschenpost } from 'flaschenpost';
import { ItemIdentifier } from '../../../../common/elements/ItemIdentifier';
import { jsonSchema } from 'uuidv4';
import { PriorityQueueStore } from '../../../../stores/priorityQueueStore/PriorityQueueStore';
import typer from 'content-type';
import { Value } from 'validate-value';
import { WolkenkitRequestHandler } from '../../../base/WolkenkitRequestHandler';

const logger = flaschenpost.getLogger();

const renewLock = {
  description: 'Renews the timeout of a locked item in the queue.',
  path: 'renew-lock',

  request: {
    body: {
      type: 'object',
      properties: {
        discriminator: { type: 'string', minLength: 1 },
        token: jsonSchema.v4
      },
      required: [ 'discriminator', 'token' ],
      additionalProperties: false
    }
  },
  response: {
    statusCodes: [],
    body: { type: 'object' }
  },

  getHandler<TItem> ({
    priorityQueueStore
  }: {
    priorityQueueStore: PriorityQueueStore<TItem, ItemIdentifier>;
  }): WolkenkitRequestHandler {
    const requestBodySchema = new Value(renewLock.request.body),
          responseBodySchema = new Value(renewLock.response.body);

    return async function (req, res): Promise<void> {
      try {
        const contentType = typer.parse(req);

        if (contentType.type !== 'application/json') {
          throw new errors.RequestMalformed();
        }
      } catch {
        const error = new errors.ContentTypeMismatch('Header content-type must be application/json.');

        res.status(415).json({
          code: error.code,
          message: error.message
        });

        return;
      }

      try {
        requestBodySchema.validate(req.body);
      } catch (ex) {
        const error = new errors.RequestMalformed(ex.message);

        res.status(400).json({
          code: error.code,
          message: error.message
        });

        return;
      }

      const { discriminator, token } = req.body;

      try {
        await priorityQueueStore.renewLock({
          discriminator,
          token
        });

        const response = {};

        responseBodySchema.validate(response);

        res.status(200).json(response);
      } catch (ex) {
        switch (ex.code) {
          case 'ETOKENMISMATCH': {
            res.status(403).json({
              code: ex.code,
              message: `Token mismatch for discriminator '${discriminator}'.`
            });

            return;
          }
          case 'EITEMNOTFOUND': {
            res.status(404).json({
              code: ex.code,
              message: ex.message
            });

            return;
          }
          default: {
            logger.error('Unknown error occured.', { ex });

            res.status(500).json({
              code: ex.code ?? 'EUNKNOWNERROR',
              message: ex.message
            });
          }
        }
      }
    };
  }
};

export { renewLock };
