import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import madge from 'madge';
import path from 'path';
import chai from 'chai';
import { fileURLToPath } from 'url';

let sandbox;
beforeEach(() => { sandbox = sinon.createSandbox(); });
afterEach(() => sandbox.restore());

describe('index.js', () => {
  describe('Syntax', () => {
    it('No javascript circular dependencies', async () => {
      const underscoreDirname = path.dirname(fileURLToPath(import.meta.url));
      const result = await madge(path.join(underscoreDirname, '../src/index.js'));
      const circularDependencies = result.circular();
      chai.expect(circularDependencies.length).to.eql(0, `Circular dependency found, ${circularDependencies[0]?.slice(-2)[0]} => ${circularDependencies[0]?.slice(-1)[0]}`);
    });
  });
});
