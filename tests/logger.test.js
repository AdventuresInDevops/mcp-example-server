import { describe, it } from 'mocha';

import logger from '../src/requestLogger.js';
logger.loggerFunc = () => {};

describe('logger.js', () => {
  describe('log()', () => {
    it('Should work and not throw an error', () => {
      const message = {
        title: 'RequestLogger',
        level: 'INFO',
        request: {
          version: '1.0',
          httpMethod: 'POST',
          headers: {
            'Content-Length': '990',
            'Content-Type': 'application/json',
            'Host': 'api.standup-and-prosper.com',
            'User-Agent': 'Slackbot 1.0 (+https://api.slack.com/robots)',
            'accept': '*/*',
            'authorization': 'bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
            'accept-encoding': 'gzip,deflate'
          }
        }
      };
      logger.log(message);
    });

    it('Handle object authorization', () => {
      const message = {
        title: 'RequestLogger',
        level: 'INFO',
        request: {
          version: '1.0',
          httpMethod: 'POST',
          headers: {
            'Content-Length': '990',
            'Content-Type': 'application/json',
            'Host': 'api.standup-and-prosper.com',
            'User-Agent': 'Slackbot 1.0 (+https://api.slack.com/robots)',
            'accept': '*/*',
            'authorization': { key: 'value' },
            'accept-encoding': 'gzip,deflate'
          }
        }
      };
      logger.log(message);
    });
  });
});
