import stringify from 'json-stringify-safe';
import cloneDeep from 'lodash/cloneDeep.js';
import shortUuid from 'short-uuid';

// Remove unnecessary strings from logging
function replacer(exposeFullLogMessage, key, value) {
  try {
    return replacerUnsafe(exposeFullLogMessage, key, value);
  } catch (error) {
    const replacementPayload = {
      message: {
        title: `Failed to log correctly which could cause downtime in the application. - ${error?.code} - ${error?.message} - ${error?.stack}`,
        level: 'CRITICAL'
      }
    };
    console.log(stringify(replacementPayload));
    return 'FAILED_TO_HANDLE_VALUE';
  }
}

function replacerUnsafe(exposeFullLogMessage, key, value) {
  if (key === 'body' && typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) { // eslint-disable-line no-unused-vars
      return value;
    }
  }
  if (value && typeof value === 'string' && key && (key.match(/authorization(?!result)/i) || value.match(/^bearer/i))
    && !value.match(/(eyJ[a-zA-Z0-9_-]{5,}\.eyJ[a-zA-Z0-9_-]{5,})\.[a-zA-Z0-9_-]*/gi)) {
    return '{AUTHORIZATION}';
  }

  if (key?.match(/(secret|signature)/i) && value) {
    return '{SECRET}';
  }

  if (key?.match('requestContext') && typeof value === 'object') {
    return { authorizer: value?.authorizer, requestId: value?.requestId };
  }

  if (key?.match('identity') && value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'cognitoIdentityPoolId')) {
    return '{-}';
  }

  if (key?.match('stageVariables')) {
    return '';
  }

  if (key === 'headers' && value && typeof value === 'object' && !exposeFullLogMessage) {
    const uselessHeaders = {
      'accept-language': true,
      'content-length': true,
      'content-type': true,
      'x-forwarded-for': true,
      'x-forwarded-port': true,
      'x-forwarded-proto': true,
      'accept': true,
      'accept-encoding': true,
      'x-amz-cf-id': true,
      'via': true
    };
    const newHeaders = Object.keys(value).filter(h => !uselessHeaders[h.toLowerCase()]).reduce((acc, h) => { acc[h] = value[h]; return acc; }, {});
    return JSON.parse(stringify(newHeaders, (...args) => replacer(exposeFullLogMessage, ...args)));
  }

  if (key === 'requestContext' && !exposeFullLogMessage) {
    const newRequestContext = cloneDeep(value || {});
    delete newRequestContext.resourceId;
    delete newRequestContext.extendedRequestId;
    delete newRequestContext.requestTime;
    delete newRequestContext.accountId;
    delete newRequestContext.protocol;
    delete newRequestContext.stage;
    delete newRequestContext.requestTimeEpoch;
    delete newRequestContext.apiId;
    return JSON.parse(stringify(newRequestContext, (...args) => replacer(exposeFullLogMessage, ...args)));
  }

  if (key === 'multiValueHeaders') {
    return undefined;
  }
  if (typeof value === 'string' && value.startsWith('<!DOCTYPE html>')) {
    return '<HTML DOCUMENT></HTML>';
  }
  return value;
}

class Logger {
  constructor(loggerFunc) {
    this.loggerFunc = loggerFunc || console.log;
    this.logDebug = true;

    this.invocationId = null;
    this.startTime = null;
    this.trackPoints = [];
    this.metadata = {};
    this.errorLoggedDuringInvocation = false;
  }

  startInvocation(metadata, timeoutOverride) {
    this.invocationId = shortUuid.generate();
    this.startTime = Date.now();
    this.trackPoints = [{ Start: { time: this.startTime } }];
    this.metadata = metadata || {};
    this.errorLoggedDuringInvocation = false;

    const capturedInvocationId = this.invocationId;
    const capturedStartTime = this.startTime;
    setTimeout(() => {
      if (this.invocationId !== capturedInvocationId) {
        return;
      }

      // Wait 5 seconds (via setTimeout), and then kick off the background process. If the background process has been frozen, then more time should have passed than was recorded in this lambda.
      // * If it is frozen for over 10 seconds, even though only "5 seconds" has passed for the lambda, then don't log anything
      // * Frozen means that the lambda completed and went into cold storage until another invocation comes. If more than 10 seconds has passed then the invocation isn't the same, but a new value hasn't been set yet.
      if (Date.now() - capturedStartTime > 10 * 1000) {
        return;
      }

      // If less than 10 seconds has passed, that means the lambda wasn't frozen, and we should fire off the real timeout track capture log.
      setTimeout(() => {
        if (this.invocationId === capturedInvocationId) {
          // This can't be TRACK, because AWS frequently will keep running our lambda even after it has returned, so leave it as INFO, and only evaluate the log message if it makes sense.
          // * "Request is still executing after 55 seconds, logging all track points in case request times out, this message itself does NOT mean there was a timeout."
          this.log({ title: 'Extended Lambda Execution logging - lambda is still running after extended period of time. This message can be logged if AWS Lambda Service decided to keep running the lambda longer than necessary or it could be a problem. To help with investigation we add this logging statement, the presence of this statement is not an error.', level: 'INFO', trackPoints: this.trackPoints });
        }
      }, timeoutOverride || 20000);
    }, 5000);
  }

  trackPoint(pointName, pointData) {
    this.trackPoints.push({ [pointName]: { time: Date.now() - this.startTime, pointData } });
  }

  error(message) {
    return this.log({ ...message, title: 'ERROR' });
  }

  log(message = { title: '', level: 'INFO', levelThreshold: 10 }) {
    let type = typeof message;
    let messageAsObject = message;
    if (type === 'undefined' || (type === 'string' && message === '')) {
      console.error('Empty message string.');
      return;
    } else if (type === 'string') {
      messageAsObject = {
        title: message
      };
    } else if (type === 'object' && Object.keys(message).length === 0) {
      console.error('Empty message object.');
      return;
    }

    messageAsObject.invocationId = this.invocationId;
    if (!messageAsObject.level) {
      messageAsObject.level = 'INFO';
    }

    if (messageAsObject.level === 'DEBUG' && !this.logDebug) {
      return;
    }

    const payload = {
      message: messageAsObject,
      metadata: Object.assign({ nodejs: process.version }, this.metadata)
    };

    this.errorLoggedDuringInvocation = this.errorLoggedDuringInvocation || messageAsObject.level === 'ERROR' || messageAsObject.level === 'CRITICAL' || messageAsObject.level === 'TRACK';
    if (this.errorLoggedDuringInvocation) {
      const stackTrace = new Error();
      stackTrace.name = 'StackTrace';
      Error.captureStackTrace(stackTrace);
      payload.stack = stackTrace.stack;
    }

    if (this.errorLoggedDuringInvocation) {
      payload.trackPoints = this.trackPoints;
    }

    let truncateToken = innerPayload => {
      return innerPayload.replace(/(eyJ[a-zA-Z0-9_-]{5,}\.eyJ[a-zA-Z0-9_-]{5,})\.[a-zA-Z0-9_-]*/gi, (m, p1) => `${p1}.<sig>`);
    };

    let stringifiedPayload = truncateToken(stringify(payload, (...args) => replacer(this.errorLoggedDuringInvocation, ...args), 2));
    // https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch_limits_cwl.html 256KB => 131072 2-byte characters
    if (stringifiedPayload.length >= 131072) {
      const replacementPayload = {
        invocationId: this.invocationId,
        message: {
          title: 'Payload too large',
          level: 'ERROR',
          originalInfo: {
            level: messageAsObject.level,
            title: messageAsObject.title,
            fields: Object.keys(messageAsObject)
          },
          truncatedPayload: truncateToken(stringify(payload, (...args) => replacer(this.errorLoggedDuringInvocation, ...args))).substring(0, 40000)
        }
      };
      stringifiedPayload = stringify(replacementPayload, (...args) => replacer(this.errorLoggedDuringInvocation, ...args), 2);
    }
    this.loggerFunc(stringifiedPayload);
  }
}

export default new Logger();
