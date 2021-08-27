import AggregateError from 'aggregate-error'
import { parse } from 'graphql'
import { CompleteMessage } from 'graphql-ws'
import { buildExecutionContext } from 'graphql/execution/execute'
import { SubscribePseudoIterable, MessageHandler, PubSubEvent } from '../types'
import { deleteConnection } from '../utils/deleteConnection'
import { buildContext } from '../utils/buildContext'
import { getResolverAndArgs } from '../utils/getResolverAndArgs'
import { isArray } from '../utils/isArray'

/** Handler function for 'complete' message. */
export const complete: MessageHandler<CompleteMessage> =
  async ({ server, event, message }) => {
    server.log('messages:complete', { connectionId: event.requestContext.connectionId })
    try {
      const subscription = await server.models.subscription.get(`${event.requestContext.connectionId}|${message.id}`)
      if (!subscription) {
        return
      }
      const execContext = buildExecutionContext(
        server.schema,
        parse(subscription.subscription.query),
        undefined,
        await buildContext({ server, connectionInitPayload: subscription.connectionInitPayload, connectionId: subscription.connectionId }),
        subscription.subscription.variables,
        subscription.subscription.operationName,
        undefined,
      )

      if (isArray(execContext)) {
        throw new AggregateError(execContext)
      }

      const [field, root, args, context, info] = getResolverAndArgs(server)(execContext)

      const onComplete = (field?.subscribe as SubscribePseudoIterable<PubSubEvent>)?.onComplete
      server.log('messages:complete:onComplete', { onComplete: !!onComplete })
      await onComplete?.(root, args, context, info)

      await server.models.subscription.delete(subscription.id)
    } catch (err) {
      server.log('messages:complete:onError', { err, event })
      await server.onError?.(err, { event, message })
      await deleteConnection(server)(event.requestContext)
    }
  }
