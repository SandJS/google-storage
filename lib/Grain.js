/**
 * Module Dependencies
 */

"use strict";

const SandGrain = require('sand-grain');
const Storage = require('./Storage');
const NotFoundError = require('./NotFoundError');


/**
 * Expose `Storage Grain`
 */
class Grain extends SandGrain {
  constructor() {
    super();
    this.name = this.configName = 'storage';
    this.defaultConfig = require('./defaultConfig');
    this.version = require('../package').version;
  }

  storage() {
    return new Storage(this.config);
  }

  bucket(name) {
    return this.storage().bucket(name || this.config.bucket);
  }

  tmpBucket(name) {
    return this.bucket(name || this.config.tmpBucket);
  }

  file(path) {
    return this.storage().file(path);
  }
}

exports = module.exports = Grain;
exports = Grain.prototype.NotFoundError = NotFoundError;