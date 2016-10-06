'use strict';

const streamEvents = require('stream-events');
const through = require('through2');
const googleAuth = require('google-auto-auth');
const duplexify = require('duplexify');
const request = require('request');
const once = require('once');
const concat = require('concat-stream');
const fs = require('fs');
const _ = require('lodash');
const pumpify = require('pumpify');
const resumableUpload = require('gcs-resumable-upload');
const arrify = require('arrify');
const es = require('event-stream');
const async = require('async');
const NotFoundError = require('./NotFoundError');
const stream = require('stream');


/**
 * @const {string}
 * @private
 */
var STORAGE_DOWNLOAD_BASE_URL = 'https://storage.googleapis.com';

/**
 * @const {string}
 * @private
 */
var STORAGE_UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/storage/v1/b';

var STORAGE_BUCKET_BASE_URL = 'https://www.googleapis.com/storage/v1/b';


class Storage {
  constructor(config) {
    this.config = _.defaults(config, {
      baseUrl: 'https://www.googleapis.com/storage/v1',
      projectIdRequired: false,
      scopes: [
        'https://www.googleapis.com/auth/devstorage.full_control'
      ],
      userAgent: 'Storage/' + require('../package').version
    });
  }

  bucket(name) {
    if (!name) {
      throw new Error('A bucket name is needed to use Google Cloud Storage.');
    }

    this.bucket = name;

    return this;
  }

  file(name) {
    if (!name) {
      throw Error('A file name must be specified.');
    }

    this.file = name;

    return this;
  }

  createReadStream(options) {
    let throughStream = streamEvents(through());

    let response = null;
    let destinationStreams = [];

    // Overriding the pipe function to make sure to pipe headers
    throughStream.pipe = function(destination, options) {
      if (response) {
        pipeToRes(destination);
      } else {
        destinationStreams.push(destination);
      }
      stream.Stream.prototype.pipe.call(this, destination, options);

      return destination;
    };

    /**
     * Special function to pipe to res streams
     * it passes along headers
     *
     * @param res
     */
    function pipeToRes(res) {
      if ((res.headers || res.setHeader) && !res.headersSent) {
        for (let key in response.headers) {
          if (!response.headers.hasOwnProperty(key)) {
            continue;
          }

          if(res.setHeader) {
            res.setHeader(key, response.headers[key]);
          } else if (_.isPlainObject(res.headers)) {
            res.headers[key] = response.headers[key];
          }
        }

        res.statusCode = response.statusCode;
      }
    }

    function makeRequest() {
      let reqOptions = {
        uri: `${STORAGE_DOWNLOAD_BASE_URL}/${this.bucket}/${encodeURIComponent(this.file)}`,
        gzip: true
      };

      let requestStream = this.makeAuthenticatedRequest(reqOptions);

      requestStream
        .on('error', function(err) {
          throughStream.destroy(err);
        })
        .on('response', function(res) {
          response = res;
          if(res.statusCode == 404) {
            throughStream.destroy(new NotFoundError('Resource Not Found'));
          } else if (res.statusCode >= 400) {
            throughStream.destroy(new Error('Encountered error while reading resource'));
          }

          // If we have destination streams then
          // lets pipe them
          destinationStreams.forEach(function(dest) {
            pipeToRes(dest);
          });
        })
        .pipe(throughStream)
        .on('error', function(e) {
          // An error can occur before the request stream has been created (during
          // authentication).
          if (requestStream.abort) {
            requestStream.abort();
          }

          requestStream.destroy();
        });
    }

    throughStream.on('reading', makeRequest.bind(this));

    return throughStream;
  }

  /**
   * Download a file into memory or file
   *
   * @param {object} options
   * @param {string} options.destination - where too download to
   * @param {function} callback - callback for when finished or error
   */
  download(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    callback = once(callback);

    var destination = options.destination;
    delete options.destination;

    var fileStream = this.createReadStream(options);

    if (destination) {
      fileStream
        .on('error', callback)
        .pipe(fs.createWriteStream(destination))
        .on('error', callback)
        .on('finish', callback);
    } else {
      fileStream
        .on('error', callback)
        .pipe(concat(callback.bind(null, null)));
    }
  }

  createWriteStream(options) {
    options = options || {};

    var self = this;

    options = _.merge({ metadata: {} }, options);

    var gzip = options.gzip;

    if (gzip) {
      options.metadata.contentEncoding = 'gzip';
    }

    var fileWriteStream = duplexify();

    var stream = streamEvents(pumpify([
      gzip ? zlib.createGzip() : through(),
      fileWriteStream
    ]));

    stream.on('writing', function() {
      self.startResumableUpload_(fileWriteStream, options);
    });

    fileWriteStream.on('response', stream.emit.bind(stream, 'response'));

    return stream;
  }

  startResumableUpload_(dup, options) {
    var self = this;

    options = _.merge({
      metadata: {}
    }, options);

    var uploadStream = resumableUpload({
      bucket: this.bucket,
      file: this.file,
      metadata: options.metadata,
      offset: options.offset,
      predefinedAcl: options.predefinedAcl,
      private: options.private,
      public: options.public,
      uri: options.uri,
      authConfig: this.config
    });

    uploadStream
      .on('response', function(resp) {
        dup.emit('response', resp);
      })
      .on('metadata', function(metadata) {
        self.metadata = metadata;
      })
      .on('finish', function() {
        dup.emit('complete');
      });

    dup.setWritable(uploadStream);
  }

  deleteFiles(query, callback) {
    let self = this;

    if (_.isFunction(query)) {
      callback = query;
      query = {};
    }

    query = query || {};

    var MAX_PARALLEL_LIMIT = 10;
    var errors = [];

    this.getFiles(query, function(err, files) {
      if (err) {
        callback(err);
        return;
      }

      function deleteFile(file, callback) {
        self.deleteFile(file).pipe(es.wait(function(err) {
          if (err) {
            if (query.force) {
              errors.push(err);
              callback();
              return;
            }

            callback(err);
            return;
          }

          callback();
        }));
      }

      // Iterate through each file and attempt to delete it.
      async.eachLimit(files, MAX_PARALLEL_LIMIT, deleteFile, function(err) {
        if (err || errors.length > 0) {
          callback(err || errors);
          return;
        }

        callback();
      });
    });
  }

  getFiles(query, callback) {
    var self = this;

    if (!callback) {
      callback = query;
      query = {};
    }

    this.makeAuthenticatedRequest({
      uri: `${STORAGE_BUCKET_BASE_URL}/${this.bucket}/o`,
      qs: query,
    }).pipe(es.wait(function(err, body) {
        if (err) {
          callback(err, null, null, body);
          return;
        }
        if (body) {
          try {
            body = JSON.parse(body.toString('utf8'));
          } catch(e) { return; }
        }

        var files = arrify(body.items).map(function (file) {
          var options = {};

          if (query.versions) {
            options.generation = file.generation;
          }

          return file.name;
        });

        var nextQuery = null;
        if (body.nextPageToken) {
          nextQuery = extend({}, query, {
            pageToken: body.nextPageToken
          });
        }

        callback(null, files, nextQuery, body);
    }));
  }

  deleteFile(path) {
    return this.makeAuthenticatedRequest({
      uri: `${STORAGE_BUCKET_BASE_URL}/${this.bucket}/o/${encodeURIComponent(path)}`,
      method: 'DELETE'
    });
  }

  delete() {
    return this.deleteFile(this.file);
  }

  makeAuthenticatedRequest(reqOptions) {
    let stream = duplexify();
    reqOptions.stream = stream;
    let callback = reqOptions.callback;
    if (callback) {
      delete reqOptions.callback;
    }

    var self = this;
    function onAuthenticated(err, authenticatedReqOpts) {
      if (err) {
        stream.destroy(err);
        return;
      }

      if (callback) {
        authenticatedReqOpts.callback = callback;
      }

      self.makeRequest(authenticatedReqOpts);
    }

    googleAuth(this.config).authorizeRequest(reqOptions, onAuthenticated);

    return stream;
  }

  makeRequest(reqOptions) {
    let dup = reqOptions.stream;
    let isGetRequest = ['GET', 'DELETE'].indexOf((reqOptions.method || 'GET').toUpperCase()) != -1;
    let requestStream = request(reqOptions);

    if (isGetRequest) {
      dup.setReadable(requestStream);
    } else {
      dup.setWritable(requestStream);
    }

    // Replay the Request events back to the stream.
    requestStream.on('error', dup.destroy.bind(dup))
      .on('response', dup.emit.bind(dup, 'response'))
      .on('complete', dup.emit.bind(dup, 'complete'));

    dup.abort = requestStream.abort;
  }
}

module.exports = Storage;
Storage.storage = function() {
  return new Storage();
};