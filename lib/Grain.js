/**
 * Module Dependencies
 */

"use strict";

const SandGrain = require('sand-grain');
const Storage = require('./Storage');


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
    return new Storage();
  }

  bucket(name) {
    if (!name) {
      name = this.config.bucket;
    }
    return (new Storage()).bucket(name);
  }

  tmpBucket(name) {
    return this.bucket(this.config.tmpBucket);
  }

  file(path) {
    return (new Storage()).file(path);
  }
}

exports = module.exports = Grain;